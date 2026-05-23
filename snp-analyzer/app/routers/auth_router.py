"""Authentication endpoints: login, logout, me, change-password."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.auth import (
    CurrentUser,
    authenticate_user,
    create_access_token,
    set_auth_cookie,
    clear_auth_cookie,
    verify_password,
    hash_password,
    get_user_by_id,
)
from app.auth_security import (
    AuthLimitExceeded,
    assert_login_allowed,
    get_client_ip,
    record_login_failure,
    record_login_success,
    validate_password_strength,
)
from app.db import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/login")
async def login(body: LoginRequest, request: Request, response: Response):
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
    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "role": user.role,
        }
    }


@router.post("/change-password")
async def change_password(body: ChangePasswordRequest, current_user: CurrentUser):
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
