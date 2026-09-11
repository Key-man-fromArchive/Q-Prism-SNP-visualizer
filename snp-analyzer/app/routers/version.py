"""Build identity of the running instance.

Deliberately unauthenticated: the footer that shows it is on every screen
including the login page, and an operator has to be able to quote a version
in a bug report before anything else works. It carries the version, the
commit it was built from when the build supplied one, and nothing else.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.version import BUILD_SHA, BUILD_TIME, __version__

router = APIRouter()


class VersionResponse(BaseModel):
    version: str
    # Empty when the build did not supply provenance, rather than invented.
    commit: str = ""
    built_at: str = ""


@router.get("/api/version", response_model=VersionResponse)
async def get_version() -> VersionResponse:
    return VersionResponse(version=__version__, commit=BUILD_SHA, built_at=BUILD_TIME)
