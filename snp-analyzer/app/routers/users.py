"""User management endpoints (admin only)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.auth import AdminUser, create_user_in_db, hash_password, get_user_by_id
from app.db import get_db

router = APIRouter(prefix="/api/users", tags=["users"])


class UserCreate(BaseModel):
    username: str
    password: str
    display_name: str | None = None
    role: str = "user"


class UserUpdate(BaseModel):
    display_name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    password: str | None = None


@router.get("")
async def list_users(admin: AdminUser):
    conn = get_db()
    rows = conn.execute(
        "SELECT id, username, display_name, role, is_active, created_at FROM users ORDER BY created_at"
    ).fetchall()
    return {
        "users": [
            {
                "id": r["id"],
                "username": r["username"],
                "display_name": r["display_name"],
                "role": r["role"],
                "is_active": bool(r["is_active"]),
                "created_at": r["created_at"],
            }
            for r in rows
        ]
    }


@router.post("")
async def create_user(body: UserCreate, admin: AdminUser):
    if body.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    # Check unique username
    conn = get_db()
    existing = conn.execute("SELECT id FROM users WHERE username = ?", (body.username,)).fetchone()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")

    user_id = create_user_in_db(
        username=body.username,
        password=body.password,
        role=body.role,
        display_name=body.display_name,
    )

    return {
        "id": user_id,
        "username": body.username,
        "display_name": body.display_name or body.username,
        "role": body.role,
        "is_active": True,
    }


@router.put("/{user_id}")
async def update_user(user_id: str, body: UserUpdate, admin: AdminUser):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    conn = get_db()
    updates = []
    params = []

    if body.display_name is not None:
        updates.append("display_name = ?")
        params.append(body.display_name)
    if body.role is not None:
        if body.role not in ("admin", "user"):
            raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")
        updates.append("role = ?")
        params.append(body.role)
    if body.is_active is not None:
        updates.append("is_active = ?")
        params.append(int(body.is_active))
    if body.password is not None:
        if len(body.password) < 4:
            raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
        updates.append("hashed_password = ?")
        params.append(hash_password(body.password))

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates.append("updated_at = datetime('now')")
    params.append(user_id)

    conn.execute(
        f"UPDATE users SET {', '.join(updates)} WHERE id = ?",
        params,
    )
    conn.commit()

    updated = get_user_by_id(user_id)
    return {
        "id": updated.id,
        "username": updated.username,
        "display_name": updated.display_name,
        "role": updated.role,
        "is_active": updated.is_active,
    }


@router.delete("/{user_id}")
async def delete_user(user_id: str, admin: AdminUser):
    if user_id == admin.user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    conn = get_db()

    # Reassign sessions and projects to admin
    conn.execute(
        "UPDATE sessions SET user_id = ? WHERE user_id = ?",
        (admin.user_id, user_id),
    )
    conn.execute(
        "UPDATE projects SET user_id = ? WHERE user_id = ?",
        (admin.user_id, user_id),
    )

    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()

    return {"status": "ok"}
