from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.routers import upload, data, clustering

app = FastAPI(title="ASG-PCR SNP Discrimination Analyzer")

app.include_router(upload.router)
app.include_router(data.router)
app.include_router(clustering.router)

static_dir = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
