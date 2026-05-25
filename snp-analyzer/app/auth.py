"""Authentication and authorization module.

Provides password hashing, JWT token management, cookie-based auth,
and FastAPI dependency functions for user/admin access control.
"""
from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel
from passlib.context import CryptContext
from jose import JWTError, jwt

from app.db import get_db
from app.auth_security import validate_password_strength
from app.config import (
    ASG_SESSION_EXPIRY_MINUTES,
    AUTH_MODE_ASG_LAUNCH,
    SNP_COOKIE_PATH,
    get_auth_mode,
    is_asg_launch_mode,
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
LOCAL_JWT_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

COOKIE_NAME = "snp_auth"
ASG_UNUSABLE_PASSWORD_PREFIX = "!asg-unusable!"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class TokenData(BaseModel):
    user_id: str
    username: str
    role: str  # "admin" | "user"


class UserInDB(BaseModel):
    id: str
    username: str
    hashed_password: str
    display_name: str | None = None
    role: str = "user"
    is_active: bool = True


# ---------------------------------------------------------------------------
# Password
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    if str(hashed or "").startswith(ASG_UNUSABLE_PASSWORD_PREFIX):
        return False
    try:
        return pwd_context.verify(plain, hashed)
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------

def get_jwt_expire_minutes() -> int:
    if is_asg_launch_mode():
        return ASG_SESSION_EXPIRY_MINUTES
    return LOCAL_JWT_EXPIRE_MINUTES


def create_access_token(user_id: str, username: str, role: str) -> str:
    auth_mode = get_auth_mode()
    expire = datetime.now(timezone.utc) + timedelta(minutes=get_jwt_expire_minutes())
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "auth_mode": auth_mode,
        "exp": expire,
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> TokenData | None:
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        username = payload.get("username")
        role = payload.get("role")
        if not user_id or not username or not role:
            return None
        if is_asg_launch_mode() and payload.get("auth_mode") != AUTH_MODE_ASG_LAUNCH:
            return None
        return TokenData(user_id=user_id, username=username, role=role)
    except JWTError:
        return None


# ---------------------------------------------------------------------------
# Cookie helpers
# ---------------------------------------------------------------------------

def set_auth_cookie(response: Response, token: str):
    secure_cookie = os.environ.get("AUTH_COOKIE_SECURE", "").lower() in {"1", "true", "yes"}
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=get_jwt_expire_minutes() * 60,
        httponly=True,
        samesite="lax",
        secure=secure_cookie,
        path=SNP_COOKIE_PATH,
    )


def clear_auth_cookie(response: Response):
    response.delete_cookie(key=COOKIE_NAME, path=SNP_COOKIE_PATH)


# ---------------------------------------------------------------------------
# DB user queries
# ---------------------------------------------------------------------------

def get_user_by_username(username: str) -> UserInDB | None:
    conn = get_db()
    row = conn.execute(
        "SELECT id, username, hashed_password, display_name, role, is_active FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    if not row:
        return None
    return UserInDB(
        id=row["id"],
        username=row["username"],
        hashed_password=row["hashed_password"],
        display_name=row["display_name"],
        role=row["role"],
        is_active=bool(row["is_active"]),
    )


def get_user_by_id(user_id: str) -> UserInDB | None:
    conn = get_db()
    row = conn.execute(
        "SELECT id, username, hashed_password, display_name, role, is_active FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    if not row:
        return None
    return UserInDB(
        id=row["id"],
        username=row["username"],
        hashed_password=row["hashed_password"],
        display_name=row["display_name"],
        role=row["role"],
        is_active=bool(row["is_active"]),
    )


def authenticate_user(username: str, password: str) -> UserInDB | None:
    user = get_user_by_username(username)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    if not user.is_active:
        return None
    return user


def create_user_in_db(
    username: str,
    password: str,
    role: str = "user",
    display_name: str | None = None,
) -> str:
    """Create a user and return the new user id."""
    validate_password_strength(password, username=username)
    conn = get_db()
    user_id = uuid.uuid4().hex[:12]
    hashed = hash_password(password)
    conn.execute(
        "INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)",
        (user_id, username, hashed, display_name or username, role),
    )
    conn.commit()
    return user_id


def upsert_asg_shadow_user(asg_user) -> UserInDB:
    """Create or update a local user mapped to an ASG account.

    ASG users are always mapped to SNP role=user for the MVP. Any future ASG
    admin policy should be added as an explicitly audited branch here.
    """
    user_id = str(asg_user.id)
    username = str(asg_user.email).strip().lower()
    display_name = asg_user.display_name or username
    unusable_password = f"{ASG_UNUSABLE_PASSWORD_PREFIX}{user_id}"

    if not user_id or not username:
        raise ValueError("ASG user id and email are required")

    conn = get_db()
    try:
        conn.execute(
            """
            INSERT INTO users (id, username, hashed_password, display_name, role, is_active)
            VALUES (?, ?, ?, ?, 'user', 1)
            ON CONFLICT(id) DO UPDATE SET
                username = excluded.username,
                hashed_password = excluded.hashed_password,
                display_name = excluded.display_name,
                role = 'user',
                is_active = 1,
                updated_at = datetime('now')
            """,
            (user_id, username, unusable_password, display_name),
        )
    except sqlite3.IntegrityError as exc:
        raise ValueError("ASG user email is already linked to another SNP user") from exc
    conn.commit()
    user = get_user_by_id(user_id)
    if not user:
        raise RuntimeError("Failed to upsert ASG shadow user")
    return user


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

async def get_current_user(request: Request) -> TokenData:
    """Extract and validate JWT from httpOnly cookie."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    data = decode_token(token)
    if not data:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Verify user still exists and is active
    user = get_user_by_id(data.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User account disabled")

    return data


async def require_admin(current_user: TokenData = Depends(get_current_user)) -> TokenData:
    """Require admin role."""
    if is_asg_launch_mode():
        raise HTTPException(status_code=403, detail="Admin access disabled in ASG launch mode")
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# Convenience type aliases for dependency injection
CurrentUser = Annotated[TokenData, Depends(get_current_user)]
AdminUser = Annotated[TokenData, Depends(require_admin)]


# ---------------------------------------------------------------------------
# Access control helpers
# ---------------------------------------------------------------------------

def check_session_access(session_id: str, user: TokenData):
    """Raise 403 if user doesn't own the session (admin bypasses)."""
    if user.role == "admin" and not is_asg_launch_mode():
        return
    from app.db import get_session_owner
    owner = get_session_owner(session_id)
    if owner is None:
        if is_asg_launch_mode():
            raise HTTPException(status_code=403, detail="Access denied to this session")
        return
    if owner != user.user_id:
        raise HTTPException(status_code=403, detail="Access denied to this session")


def check_project_access(project_id: str, user: TokenData):
    """Raise 403 if user doesn't own the project (admin bypasses)."""
    if user.role == "admin" and not is_asg_launch_mode():
        return
    conn = get_db()
    row = conn.execute("SELECT user_id FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row and row["user_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Access denied to this project")
