"""Authentication endpoints: login, logout, me, change-password."""
from __future__ import annotations

from fastapi import APIRouter, Response
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
from app.db import get_db
from fastapi import HTTPException

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/login")
async def login(body: LoginRequest, response: Response):
    user = authenticate_user(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")

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

    if len(body.new_password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    hashed = hash_password(body.new_password)
    conn = get_db()
    conn.execute(
        "UPDATE users SET hashed_password = ?, updated_at = datetime('now') WHERE id = ?",
        (hashed, current_user.user_id),
    )
    conn.commit()

    return {"status": "ok"}
