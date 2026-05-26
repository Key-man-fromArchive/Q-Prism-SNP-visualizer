"""Authentication endpoints: login, logout, me, change-password."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.auth import (
    CurrentUser,
    upsert_asg_shadow_user,
    authenticate_user,
    create_access_token,
    set_auth_cookie,
    clear_auth_cookie,
    verify_password,
    hash_password,
    get_user_by_id,
)
from app.asg_client import ASGLaunchValidationError, validate_launch_token
from app.asg_session import get_current_asg_launch, remember_asg_launch
from app.auth_security import (
    AuthLimitExceeded,
    assert_login_allowed,
    get_client_ip,
    record_login_failure,
    record_login_success,
    validate_password_strength,
)
from app.config import ASG_LAUNCH_COOKIE_NAME, ASG_LAUNCH_COOKIE_PATH, get_auth_mode, is_asg_launch_mode
from app.db import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ASGLaunchRequest(BaseModel):
    token: str


@router.get("/config")
async def auth_config():
    return {"auth_mode": get_auth_mode()}


@router.post("/login")
async def login(body: LoginRequest, request: Request, response: Response):
    if is_asg_launch_mode():
        raise HTTPException(status_code=404, detail="Local login is disabled")

    client_ip = get_client_ip(request)
    try:
        assert_login_allowed(body.username, client_ip)
    except AuthLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Try again later.",
            headers={"Retry-After": str(exc.retry_after)},
        )

    user = authenticate_user(body.username, body.password)
    if not user:
        record_login_failure(body.username, client_ip)
        raise HTTPException(status_code=401, detail="Invalid username or password")

    record_login_success(user.username, client_ip)
    token = create_access_token(user.id, user.username, user.role)
    set_auth_cookie(response, token)

    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "role": user.role,
        }
    }


@router.post("/logout")
async def logout(response: Response):
    clear_auth_cookie(response)
    return {"status": "ok"}


@router.get("/me")
async def me(current_user: CurrentUser):
    user = get_user_by_id(current_user.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    payload = {
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "role": user.role,
        }
    }
    if is_asg_launch_mode():
        launch = get_current_asg_launch(user.id)
        if launch is not None:
            payload["linked_context"] = {
                "target_type": launch.target_type,
                "target_id": launch.target_id,
                "context": launch.context,
                "scope": list(launch.scope),
                "expires_at": launch.expires_at.isoformat() if launch.expires_at else None,
            }
    return payload


@router.post("/change-password")
async def change_password(body: ChangePasswordRequest, current_user: CurrentUser):
    if is_asg_launch_mode():
        raise HTTPException(status_code=404, detail="Password changes are disabled")

    user = get_user_by_id(current_user.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    try:
        validate_password_strength(body.new_password, username=user.username)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    hashed = hash_password(body.new_password)
    conn = get_db()
    conn.execute(
        "UPDATE users SET hashed_password = ?, updated_at = datetime('now') WHERE id = ?",
        (hashed, current_user.user_id),
    )
    conn.commit()

    return {"status": "ok"}


@router.post("/asg-launch")
async def asg_launch(body: ASGLaunchRequest, response: Response):
    return _complete_asg_launch(body.token, response)


@router.post("/asg-launch-cookie")
async def asg_launch_cookie(request: Request, response: Response):
    raw_token = request.cookies.get(ASG_LAUNCH_COOKIE_NAME, "")
    if not raw_token:
        raise HTTPException(status_code=401, detail="ASG launch cookie is missing")

    payload = _complete_asg_launch(raw_token, response)
    response.delete_cookie(key=ASG_LAUNCH_COOKIE_NAME, path=ASG_LAUNCH_COOKIE_PATH)
    return payload


def _complete_asg_launch(raw_token: str, response: Response):
    if not is_asg_launch_mode():
        raise HTTPException(status_code=404, detail="ASG launch is disabled")

    try:
        validation = validate_launch_token(raw_token)
    except ASGLaunchValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    try:
        user = upsert_asg_shadow_user(validation.user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    token = create_access_token(user.id, user.username, user.role)
    set_auth_cookie(response, token)
    remember_asg_launch(
        user.id,
        validation.target,
        validation.launch,
        validation.scope,
        validation.expires_at,
    )

    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "role": user.role,
        },
        "linked_context": {
            "target_type": validation.target.target_type,
            "target_id": validation.target.target_id,
            "context": validation.target.context,
            "scope": validation.scope,
            "expires_at": validation.expires_at.isoformat() if validation.expires_at else None,
        },
    }
