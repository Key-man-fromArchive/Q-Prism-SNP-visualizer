import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.routers import upload, data, clustering, export, qc, sample, compare, statistics, presets, quality, batch
from app.routers import auth_router, users


def _ensure_admin():
    """Create admin user from env vars if users table is empty."""
    from app.db import get_db
    from app.auth import create_user_in_db

    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if count > 0:
        return

    admin_user = os.environ.get("ADMIN_USER", "admin")
    admin_pass = os.environ.get("ADMIN_PASSWORD", "changeme")

    user_id = create_user_in_db(
        username=admin_user,
        password=admin_pass,
        role="admin",
        display_name="Administrator",
    )
    print(f"[AUTH] Created admin user: {admin_user}")

    # Assign orphan sessions (user_id IS NULL) to admin
    conn.execute("UPDATE sessions SET user_id = ? WHERE user_id IS NULL", (user_id,))
    conn.commit()
    orphan_count = conn.execute("SELECT changes()").fetchone()[0]
    if orphan_count:
        print(f"[AUTH] Assigned {orphan_count} orphan session(s) to admin")


def _migrate_projects_json():
    """One-time migration from projects.json to DB projects table."""
    projects_file = Path(__file__).parent / "data" / "projects.json"
    if not projects_file.exists():
        return

    try:
        projects = json.loads(projects_file.read_text())
    except (json.JSONDecodeError, IOError):
        return

    if not projects:
        projects_file.rename(projects_file.with_suffix(".json.migrated"))
        return

    from app.db import get_db
    conn = get_db()

    # Get admin user id (first admin)
    admin_row = conn.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    if not admin_row:
        return
    admin_id = admin_row["id"]

    # Check if projects table already has data
    existing = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
    if existing > 0:
        projects_file.rename(projects_file.with_suffix(".json.migrated"))
        return

    for p in projects:
        conn.execute(
            "INSERT OR IGNORE INTO projects (id, name, user_id, created_at) VALUES (?, ?, ?, ?)",
            (p["id"], p["name"], admin_id, p.get("created_at", "")),
        )
        for idx, sid in enumerate(p.get("session_ids", [])):
            conn.execute(
                "INSERT OR IGNORE INTO project_sessions (project_id, session_id, position) VALUES (?, ?, ?)",
                (p["id"], sid, idx),
            )

    conn.commit()
    projects_file.rename(projects_file.with_suffix(".json.migrated"))
    print(f"[AUTH] Migrated {len(projects)} project(s) from projects.json to DB")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: init DB and restore sessions
    from app.db import init_db, load_all_sessions

    init_db()
    _ensure_admin()
    _migrate_projects_json()

    for entry in load_all_sessions():
        upload.sessions[entry["session_id"]] = entry["unified"]
        if entry["clustering"]:
            clustering.cluster_store[entry["session_id"]] = entry["clustering"]
        if entry["welltypes"]:
            clustering.welltype_store[entry["session_id"]] = entry["welltypes"]
        if entry["sample_overrides"]:
            sample.sample_name_store[entry["session_id"]] = entry["sample_overrides"]
        if entry["protocol_override"]:
            data.protocol_store[entry["session_id"]] = entry["protocol_override"]
    yield


app = FastAPI(title="ASG-PCR SNP Discrimination Analyzer", lifespan=lifespan)

app.include_router(auth_router.router)
app.include_router(users.router)
app.include_router(upload.router)
app.include_router(data.router)
app.include_router(clustering.router)
app.include_router(export.router)
app.include_router(qc.router)
app.include_router(sample.router)
app.include_router(compare.router)
app.include_router(statistics.router)
app.include_router(presets.router)
app.include_router(quality.router)
app.include_router(batch.router)

# Serve React build (default) or legacy static (USE_LEGACY=1)
use_legacy = os.environ.get("USE_LEGACY", "").strip().lower() in ("1", "true", "yes")

if use_legacy:
    static_dir = Path(__file__).parent / "static"
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
else:
    static_react_dir = Path(__file__).parent / "static-react"
    if static_react_dir.exists():
        app.mount("/", StaticFiles(directory=str(static_react_dir), html=True), name="static")
    else:
        # Fallback to legacy if React build not found
        static_dir = Path(__file__).parent / "static"
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
