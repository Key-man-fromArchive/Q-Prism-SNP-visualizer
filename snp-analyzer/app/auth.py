"""Authentication and authorization module.

Provides password hashing, JWT token management, cookie-based auth,
and FastAPI dependency functions for user/admin access control.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel
from passlib.context import CryptContext
from jose import JWTError, jwt

from app.db import get_db

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

COOKIE_NAME = "snp_auth"
COOKIE_MAX_AGE = JWT_EXPIRE_MINUTES * 60  # seconds

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
    return pwd_context.verify(plain, hashed)


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------

def create_access_token(user_id: str, username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
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
        return TokenData(user_id=user_id, username=username, role=role)
    except JWTError:
        return None


# ---------------------------------------------------------------------------
# Cookie helpers
# ---------------------------------------------------------------------------

def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=False,  # Set True if using HTTPS
        path="/",
    )


def clear_auth_cookie(response: Response):
    response.delete_cookie(key=COOKIE_NAME, path="/")


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
    conn = get_db()
    user_id = uuid.uuid4().hex[:12]
    hashed = hash_password(password)
    conn.execute(
        "INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)",
        (user_id, username, hashed, display_name or username, role),
    )
    conn.commit()
    return user_id


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
    if user.role == "admin":
        return
    from app.db import get_session_owner
    owner = get_session_owner(session_id)
    if owner and owner != user.user_id:
        raise HTTPException(status_code=403, detail="Access denied to this session")


def check_project_access(project_id: str, user: TokenData):
    """Raise 403 if user doesn't own the project (admin bypasses)."""
    if user.role == "admin":
        return
    conn = get_db()
    row = conn.execute("SELECT user_id FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row and row["user_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Access denied to this project")
