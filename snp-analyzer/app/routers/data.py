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
from app.auth import CurrentUser, check_session_access

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
async def scatter_data(sid: str, current_user: CurrentUser, cycle: int = Query(default=0), use_rox: bool = Query(default=True)):
    check_session_access(sid, current_user)
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
async def plate_data(sid: str, current_user: CurrentUser, cycle: int = Query(default=0), use_rox: bool = Query(default=True)):
    check_session_access(sid, current_user)
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
    sid: str, current_user: CurrentUser, wells: str = Query(default=""), use_rox: bool = Query(default=True)
):
    check_session_access(sid, current_user)
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


@router.get("/api/data/{sid}/amplification/all")
async def amplification_all(sid: str, current_user: CurrentUser, use_rox: bool = Query(default=True)):
    """Return amplification curves for ALL wells with effective genotype type."""
    check_session_access(sid, current_user)
    unified = _get_session(sid)
    all_normalized = normalize(unified.data, unified.has_rox, use_rox)

    # Get genotype assignments
    ca = cluster_store.get(sid)
    cluster_assignments = ca.assignments if ca else {}
    manual_assignments = welltype_store.get(sid, {})

    # Group by well
    well_data: dict[str, list] = {}
    for p in all_normalized:
        well_data.setdefault(p.well, []).append(p)

    curves = []
    for well in sorted(well_data.keys(), key=lambda w: (w[0], int(w[1:]))):
        pts = sorted(well_data[well], key=lambda p: p.cycle)
        effective = manual_assignments.get(well) or cluster_assignments.get(well) or "Unknown"
        curves.append({
            "well": well,
            "cycles": [p.cycle for p in pts],
            "norm_fam": [p.norm_fam for p in pts],
            "norm_allele2": [p.norm_allele2 for p in pts],
            "effective_type": effective,
        })

    return {"allele2_dye": unified.allele2_dye, "curves": curves}


@router.get("/api/data/{sid}/ct")
async def ct_data(sid: str, current_user: CurrentUser, use_rox: bool = Query(default=True)):
    check_session_access(sid, current_user)
    unified = _get_session(sid)
    if len(unified.cycles) < 3:
        return {"results": {}, "allele2_dye": unified.allele2_dye}

    from app.processing.ct_calculation import calculate_all_ct
    results = calculate_all_ct(unified, use_rox)
    return {"results": results, "allele2_dye": unified.allele2_dye}


@router.get("/api/data/{sid}/export/pdf")
async def export_pdf(sid: str, current_user: CurrentUser, use_rox: bool = Query(default=True)):
    check_session_access(sid, current_user)
    from fastapi.responses import Response
    from app.processing.normalize import normalize_for_cycle
    from app.processing.ct_calculation import calculate_all_ct
    from app.reporting.pdf_builder import build_report

    unified = _get_session(sid)
    cycle = max(unified.cycles)

    # Get scatter points with effective types
    points = normalize_for_cycle(unified.data, cycle, unified.has_rox, use_rox)
    cluster_assignments = cluster_store.get(sid, None)
    manual_assignments = welltype_store.get(sid, {})

    scatter_points = []
    plate_wells = []
    for p in points:
        auto_type = cluster_assignments.assignments.get(p.well) if cluster_assignments else None
        manual_type = manual_assignments.get(p.well)
        effective_type = manual_type or auto_type or "Unknown"

        scatter_points.append({
            "well": p.well,
            "norm_fam": p.norm_fam,
            "norm_allele2": p.norm_allele2,
            "effective_type": effective_type,
        })

        row = ord(p.well[0]) - ord("A")
        col = int(p.well[1:]) - 1
        plate_wells.append({
            "well": p.well,
            "row": row,
            "col": col,
            "effective_type": effective_type,
        })

    # Ct results
    ct_results = None
    if len(unified.cycles) >= 3:
        ct_results = calculate_all_ct(unified, use_rox)

    # Get filename from DB if available
    filename = ""
    try:
        from app.db import get_db
        row = get_db().execute(
            "SELECT raw_filename FROM sessions WHERE session_id = ?", (sid,)
        ).fetchone()
        if row:
            filename = row["raw_filename"] or ""
    except Exception:
        pass

    pdf_bytes = build_report(
        session_id=sid,
        instrument=unified.instrument,
        allele2_dye=unified.allele2_dye,
        num_wells=len(unified.wells),
        num_cycles=len(unified.cycles),
        scatter_points=scatter_points,
        plate_wells=plate_wells,
        ct_results=ct_results,
        filename=filename,
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="snp_report_{sid}.pdf"'},
    )


@router.get("/api/data/{sid}/protocol")
async def get_protocol(sid: str, current_user: CurrentUser):
    check_session_access(sid, current_user)
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
async def save_protocol(sid: str, current_user: CurrentUser, steps: list[ProtocolStep]):
    check_session_access(sid, current_user)
    _get_session(sid)
    protocol_store[sid] = steps

    import json
    from app.db import save_protocol_override
    save_protocol_override(sid, json.dumps([s.model_dump() for s in steps]))

    return {"status": "ok"}
