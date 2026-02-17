"""Signal quality scoring API."""
from fastapi import APIRouter, HTTPException, Query

from app.routers.upload import sessions

router = APIRouter()


@router.get("/api/data/{sid}/quality")
async def get_quality(sid: str, use_rox: bool = Query(default=True)):
    if sid not in sessions:
        raise HTTPException(404, "Session not found")
    unified = sessions[sid]

    if len(unified.cycles) < 3:
        return {"results": {}, "summary": {"mean_score": 0, "low_quality_count": 0, "total_wells": 0}}

    from app.processing.quality import score_all_wells

    results = score_all_wells(unified, use_rox)

    # Summary stats
    scores = [r["score"] for r in results.values()]
    mean_score = sum(scores) / len(scores) if scores else 0
    low_quality = sum(1 for s in scores if s < 50)

    return {
        "results": results,
        "summary": {
            "mean_score": round(mean_score, 1),
            "low_quality_count": low_quality,
            "total_wells": len(scores),
        },
    }
