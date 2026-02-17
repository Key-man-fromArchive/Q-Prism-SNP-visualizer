from fastapi import APIRouter, HTTPException, Query

from app.models import (
    ScatterPoint,
    PlateWell,
    AmplificationCurve,
    ProtocolStep,
    UnifiedData,
)
from app.processing.normalize import normalize_for_cycle, normalize
from app.routers.upload import sessions
from app.routers.clustering import cluster_store, welltype_store

router = APIRouter()

# Protocol store: session_id -> list[ProtocolStep]
protocol_store: dict[str, list[ProtocolStep]] = {}

DEFAULT_PROTOCOL = [
    ProtocolStep(step=1, temperature=94.0, duration_sec=900, cycles=1, label="Initial Denaturation"),
    ProtocolStep(step=2, temperature=94.0, duration_sec=20, cycles=10, label="Denaturation (Touchdown)"),
    ProtocolStep(step=3, temperature=61.0, duration_sec=60, cycles=10, label="Annealing (Touchdown -0.6/cycle)"),
    ProtocolStep(step=4, temperature=94.0, duration_sec=20, cycles=25, label="Denaturation"),
    ProtocolStep(step=5, temperature=55.0, duration_sec=60, cycles=25, label="Annealing"),
    ProtocolStep(step=6, temperature=37.0, duration_sec=60, cycles=1, label="Final Read"),
]


def _get_session(sid: str) -> UnifiedData:
    if sid not in sessions:
        raise HTTPException(404, "Session not found")
    return sessions[sid]


@router.get("/api/data/{sid}/scatter")
async def scatter_data(sid: str, cycle: int = Query(default=0), use_rox: bool = Query(default=True)):
    unified = _get_session(sid)

    if cycle <= 0:
        cycle = max(unified.cycles)

    if cycle not in unified.cycles:
        raise HTTPException(400, f"Cycle {cycle} not available. Range: {unified.cycles[0]}-{unified.cycles[-1]}")

    points = normalize_for_cycle(unified.data, cycle, unified.has_rox, use_rox)

    cluster_assignments = {}
    if sid in cluster_store:
        cluster_assignments = cluster_store[sid].assignments
    manual_assignments = welltype_store.get(sid, {})

    return {
        "cycle": cycle,
        "allele2_dye": unified.allele2_dye,
        "points": [
            ScatterPoint(
                well=p.well,
                norm_fam=p.norm_fam,
                norm_allele2=p.norm_allele2,
                raw_fam=p.raw_fam,
                raw_allele2=p.raw_allele2,
                raw_rox=p.raw_rox,
                sample_name=(unified.sample_names or {}).get(p.well),
                auto_cluster=cluster_assignments.get(p.well),
                manual_type=manual_assignments.get(p.well),
            )
            for p in points
        ],
    }


@router.get("/api/data/{sid}/plate")
async def plate_data(sid: str, cycle: int = Query(default=0), use_rox: bool = Query(default=True)):
    unified = _get_session(sid)

    if cycle <= 0:
        cycle = max(unified.cycles)

    points = normalize_for_cycle(unified.data, cycle, unified.has_rox, use_rox)

    cluster_assignments_plate = {}
    if sid in cluster_store:
        cluster_assignments_plate = cluster_store[sid].assignments
    manual_assignments_plate = welltype_store.get(sid, {})

    wells = []
    for p in points:
        row = ord(p.well[0]) - ord("A")
        col = int(p.well[1:]) - 1
        total = p.norm_fam + p.norm_allele2
        ratio = p.norm_fam / total if total > 0 else 0.5
        wells.append(
            PlateWell(
                well=p.well,
                row=row,
                col=col,
                norm_fam=p.norm_fam,
                norm_allele2=p.norm_allele2,
                ratio=round(ratio, 4),
                sample_name=(unified.sample_names or {}).get(p.well),
                auto_cluster=cluster_assignments_plate.get(p.well),
                manual_type=manual_assignments_plate.get(p.well),
            )
        )

    return {"cycle": cycle, "allele2_dye": unified.allele2_dye, "wells": wells}


@router.get("/api/data/{sid}/amplification")
async def amplification_data(
    sid: str, wells: str = Query(default=""), use_rox: bool = Query(default=True)
):
    unified = _get_session(sid)
    well_list = [w.strip() for w in wells.split(",") if w.strip()]

    if not well_list:
        raise HTTPException(400, "Provide at least one well, e.g., ?wells=A5,A6")

    all_normalized = normalize(unified.data, unified.has_rox, use_rox)

    curves = []
    for well in well_list:
        well_points = sorted(
            [p for p in all_normalized if p.well == well],
            key=lambda p: p.cycle,
        )
        if well_points:
            curves.append(
                AmplificationCurve(
                    well=well,
                    cycles=[p.cycle for p in well_points],
                    norm_fam=[p.norm_fam for p in well_points],
                    norm_allele2=[p.norm_allele2 for p in well_points],
                )
            )

    return {"allele2_dye": unified.allele2_dye, "curves": curves}


@router.get("/api/data/{sid}/protocol")
async def get_protocol(sid: str):
    unified = _get_session(sid)
    # Use protocol from .eds file if available, then user-saved, then default
    if sid in protocol_store:
        steps = protocol_store[sid]
    elif unified.protocol_steps:
        steps = unified.protocol_steps
    else:
        steps = DEFAULT_PROTOCOL
    return {"steps": steps}


@router.post("/api/data/{sid}/protocol")
async def save_protocol(sid: str, steps: list[ProtocolStep]):
    _get_session(sid)
    protocol_store[sid] = steps
    return {"status": "ok"}
