"""ASG Designer integration endpoints."""
from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.asg_client import ASGResultSaveError, post_analysis_result
from app.asg_result import build_result_snapshot
from app.auth import CurrentUser, check_session_access
from app.config import is_asg_launch_mode
from app.processing.background import BackgroundMode

router = APIRouter(prefix="/api/asg", tags=["asg"])


class SaveResultRequest(BaseModel):
    session_id: str
    selected_cycle: int | None = None
    use_rox: bool | None = None
    background: BackgroundMode | None = None
    result_revision: UUID | None = None


@router.post("/save-result")
async def save_result(body: SaveResultRequest, current_user: CurrentUser):
    if not is_asg_launch_mode():
        raise HTTPException(status_code=404, detail="ASG save is disabled")

    check_session_access(body.session_id, current_user)
    payload = build_result_snapshot(
        body.session_id,
        user=current_user,
        selected_cycle=body.selected_cycle,
        use_rox=body.use_rox,
        background=body.background,
        result_revision=body.result_revision,
    )
    try:
        response = post_analysis_result(payload)
    except ASGResultSaveError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return {
        "status": "saved",
        "analysis_run_id": response.get("analysis_run_id"),
        "created": response.get("created"),
        "target_type": response.get("target_type") or payload["result"]["asg_target"]["target_type"],
        "target_id": response.get("target_id") or payload["result"]["asg_target"]["target_id"],
    }
