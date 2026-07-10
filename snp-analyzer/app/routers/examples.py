"""Load synthetic example datasets (2x–8x) as analysis sessions — a demo/QA
convenience so a user can see genotyping at each ploidy without a real file."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser
from app.examples import build_example, list_examples
from app.models import UploadResponse
from app.processing.genotype_vocab import validate_ploidy
from app.routers.upload import sessions
from app.services.import_session import create_session_from_import

router = APIRouter()


class ExampleRequest(BaseModel):
    ploidy: int


@router.get("/api/examples")
async def get_examples(current_user: CurrentUser):
    return {"examples": list_examples()}


@router.post("/api/examples", response_model=UploadResponse)
async def load_example(body: ExampleRequest, current_user: CurrentUser):
    try:
        validate_ploidy(body.ploidy)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    unified = build_example(body.ploidy)
    return create_session_from_import(
        unified=unified,
        filename=f"example_{body.ploidy}x.synthetic",
        user_id=current_user.user_id,
        session_store=sessions,
    )
