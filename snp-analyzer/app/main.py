import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.routers import upload, data, clustering, export, qc, sample, compare, statistics, presets, quality, batch


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: init DB and restore sessions
    from app.db import init_db, load_all_sessions

    init_db()
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
