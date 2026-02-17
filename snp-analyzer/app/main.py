from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.routers import upload, data, clustering, export, qc, sample, compare

app = FastAPI(title="ASG-PCR SNP Discrimination Analyzer")

app.include_router(upload.router)
app.include_router(data.router)
app.include_router(clustering.router)
app.include_router(export.router)
app.include_router(qc.router)
app.include_router(sample.router)
app.include_router(compare.router)

static_dir = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
