"""User management endpoints (admin only)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.auth import AdminUser, create_user_in_db, hash_password, get_user_by_id
from app.db import get_db

router = APIRouter(prefix="/api/users", tags=["users"])
admin_router = APIRouter(prefix="/api/admin", tags=["admin"])


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


@admin_router.get("/dashboard")
async def admin_dashboard(admin: AdminUser):
    conn = get_db()

    # Get all users
    users = conn.execute(
        "SELECT id, username, display_name, role, is_active, created_at FROM users ORDER BY created_at"
    ).fetchall()

    result = []
    for u in users:
        uid = u["id"]

        # Count sessions owned by this user
        sessions = conn.execute(
            """SELECT session_id, instrument, num_wells, num_cycles, raw_filename, created_at
               FROM sessions WHERE user_id = ? ORDER BY created_at DESC""",
            (uid,),
        ).fetchall()

        # Count projects owned by this user
        projects = conn.execute(
            """SELECT p.id, p.name, p.created_at, COUNT(ps.session_id) as session_count
               FROM projects p LEFT JOIN project_sessions ps ON p.id = ps.project_id
               WHERE p.user_id = ?
               GROUP BY p.id ORDER BY p.created_at DESC""",
            (uid,),
        ).fetchall()

        # Total disk usage estimate: count well_cycle_data rows for this user's sessions
        session_ids = [s["session_id"] for s in sessions]
        total_data_points = 0
        if session_ids:
            placeholders = ",".join("?" * len(session_ids))
            row = conn.execute(
                f"SELECT COUNT(*) as cnt FROM well_cycle_data WHERE session_id IN ({placeholders})",
                session_ids,
            ).fetchone()
            total_data_points = row["cnt"] if row else 0

        result.append({
            "id": uid,
            "username": u["username"],
            "display_name": u["display_name"],
            "role": u["role"],
            "is_active": bool(u["is_active"]),
            "created_at": u["created_at"],
            "session_count": len(sessions),
            "project_count": len(projects),
            "total_data_points": total_data_points,
            "sessions": [
                {
                    "session_id": s["session_id"],
                    "instrument": s["instrument"],
                    "num_wells": s["num_wells"],
                    "num_cycles": s["num_cycles"],
                    "raw_filename": s["raw_filename"] or "",
                    "created_at": s["created_at"],
                }
                for s in sessions
            ],
            "projects": [
                {
                    "id": p["id"],
                    "name": p["name"],
                    "session_count": p["session_count"],
                    "created_at": p["created_at"],
                }
                for p in projects
            ],
        })

    return {"users": result}


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
