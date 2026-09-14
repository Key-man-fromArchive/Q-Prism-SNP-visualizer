import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from app.processing.background import BackgroundModeError
from fastapi.staticfiles import StaticFiles

from app.routers import upload, import_api, data, clustering, export, qc, sample, compare, statistics, presets, quality, batch, asg, examples, layouts, marker_catalog
from app.routers import feedback, version
from app.routers import auth_router, users
from app.auth_security import assert_auth_configuration
from app.config import SNP_ROOT_PATH, is_asg_launch_mode


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
    # Startup: init DB only. Sessions are deliberately NOT eagerly restored
    # into memory here (P28) -- this process used to loop over every DB
    # session at startup (db.load_all_sessions()) and reconstruct all of
    # them, including every well's full cycle data, before the app would
    # accept a request. That is unbounded startup work that grows with the
    # workspace (production was observed with 47 sessions / ~100k readings
    # and climbing) and a slow/killed startup left memory holding NONE of
    # them despite the DB holding all of them -- the exact bug this restore
    # work exists to fix. Each session is now restored lazily, one at a
    # time, the first time something asks for it -- see
    # app.services.session_restore.get_session/restore_session, which every
    # router now calls instead of touching app.routers.upload.sessions
    # directly. GET /api/sessions (the workspace list) reads session summary
    # columns straight from the DB and never touches this cache either.
    from app.db import init_db

    assert_auth_configuration()
    init_db()
    if not is_asg_launch_mode():
        _ensure_admin()
    _migrate_projects_json()

    yield


app = FastAPI(
    title="Q-prism® Cluster Caller",
    lifespan=lifespan,
    root_path=SNP_ROOT_PATH,
)


@app.exception_handler(BackgroundModeError)
async def _background_mode_error(request, exc: BackgroundModeError):
    """A background mode the run cannot be read with is bad input, not a bug.

    Narrow on purpose: only this exception type is mapped, so a genuine
    ValueError from anywhere else still surfaces as a 500 instead of being
    quietly relabelled as the caller's fault.
    """
    from fastapi.responses import JSONResponse

    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.middleware("http")
async def add_security_headers(request, call_next):
    if is_asg_launch_mode() and _is_disabled_local_auth_path(request.url.path):
        from fastapi.responses import JSONResponse

        return JSONResponse({"detail": "Local auth endpoint disabled"}, status_code=404)

    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    if request.url.path.startswith("/api/auth/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


def _is_disabled_local_auth_path(path: str) -> bool:
    if path in {"/api/auth/login", "/api/auth/change-password"}:
        return True
    if path == "/api/users" or path.startswith("/api/users/"):
        return True
    if path == "/api/admin" or path.startswith("/api/admin/"):
        return True
    return False

app.include_router(auth_router.router)
app.include_router(users.router)
app.include_router(users.admin_router)
app.include_router(upload.router)
app.include_router(import_api.router)
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
app.include_router(asg.router)
app.include_router(examples.router)
app.include_router(layouts.router)
app.include_router(marker_catalog.router)
app.include_router(feedback.router)
app.include_router(version.router)

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
