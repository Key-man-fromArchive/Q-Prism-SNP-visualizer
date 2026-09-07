"""Compact ASG adapter over a shared accepted result."""
from copy import deepcopy
from uuid import UUID

from fastapi import HTTPException
from pydantic import TypeAdapter

from app.asg_session import LinkedASGLaunch, get_session_asg_launch
from app.auth import TokenData, check_session_access
from app.processing.analysis_state import input_lock
from app.processing.background import BackgroundMode
from app.processing.cycle_selection import CycleMode
from app.processing.ct_calculation import calculate_all_ct
from app.processing.genotype import count_genotypes
from app.processing.statistics import allele_frequencies, hwe_test
from app.reporting.result_snapshot import (
    ExportOptions, ResultRow, ResultSnapshot, capture_result_snapshot, snapshot_rows,
)


def _capture_asg(session_id: str, user: TokenData, options: ExportOptions) -> tuple[ResultSnapshot, LinkedASGLaunch]:
    from app.routers.clustering import cluster_store
    from app.routers.upload import sessions

    with input_lock:
        check_session_access(session_id, user)
        if session_id not in sessions:
            raise HTTPException(404, "Session not found")
        launch = get_session_asg_launch(session_id)
        if launch is None:
            raise HTTPException(409, "Session is not linked to an ASG launch")
        if not launch.allows_save():
            raise HTTPException(403, "ASG launch does not allow saving results")
        cluster = cluster_store.get(session_id)
        if cluster is not None and cluster.regions:
            raise HTTPException(409, "multi-marker ASG save requires schema_version 3 (pending)")
        return capture_result_snapshot(session_id, user, options), deepcopy(launch)


def _asg_well(row: ResultRow, snapshot: ResultSnapshot, ct: dict) -> dict:
    point = row.point
    coordinates = {key: getattr(point, key) if point is not None else None
                   for key in ("norm_fam", "norm_allele2", "raw_fam", "raw_allele2", "raw_rox")}
    manual = TypeAdapter(dict[str, str]).validate_python(snapshot.context.parameters["manual_well_types"])
    return {"well": row.well, "sample_name": row.sample_name or None,
            **coordinates, "auto_cluster": snapshot.result.assignments.get(row.well),
            "manual_type": manual.get(row.well), "effective_type": row.genotype,
            "confidence": row.confidence, "fam_ct": ct.get("fam_ct"),
            "allele2_ct": ct.get("allele2_ct"), "read_status": row.read_status,
            "assignment_status": row.assignment_status}


def _summary(snapshot: ResultSnapshot, rows: list[ResultRow]) -> dict:
    ploidy = snapshot.result.ploidy
    counts = count_genotypes({row.well: row.genotype for row in rows}, ploidy)
    frequency = hwe = None
    if ploidy == 2:
        frequency = allele_frequencies(counts["AA"], counts["AB"], counts["BB"])
        hwe = hwe_test(counts["AA"], counts["AB"], counts["BB"])
    return {"genotype_counts": counts, "allele_frequency": frequency, "hwe": hwe,
            "ploidy": ploidy, "offset": snapshot.result.offset,
            "total_wells": len(rows), "cluster_algorithm": snapshot.result.algorithm,
            "cluster_cycle": snapshot.context.cycle}


def _render_asg(snapshot: ResultSnapshot, launch: LinkedASGLaunch) -> dict:
    unified, result, context = snapshot.unified, snapshot.result, snapshot.context
    rows = snapshot_rows(snapshot)
    ct = calculate_all_ct(unified, context.use_rox) if len(unified.cycles) >= 3 else {}
    manual = TypeAdapter(dict[str, str]).validate_python(context.parameters["manual_well_types"])
    return {
        "schema_version": 1 if result.ploidy == 2 else 2,
        "ploidy": result.ploidy,
        "launch": {"id": launch.launch_id, "save_token": launch.save_token},
        "session_id": snapshot.session_id,
        "file": {"name": snapshot.raw_filename, "sha256": ""},
        "instrument": {"name": unified.instrument, "allele2_dye": unified.allele2_dye,
                       "has_rox": unified.has_rox, "num_wells": len(unified.wells),
                       "num_cycles": len(unified.cycles)},
        "selected_cycle": context.cycle, "summary": _summary(snapshot, rows),
        "result": {
            "asg_target": {"target_type": launch.target_type, "target_id": launch.target_id,
                           "context": launch.context},
            "wells": [_asg_well(row, snapshot, ct.get(row.well, {})) for row in rows],
            "clustering": {"algorithm": result.algorithm, "cycle": result.cycle,
                           "assignments": result.assignments},
            "manual_welltypes": manual, "sample_names": snapshot.sample_names,
            "well_groups": {name: {"wells": wells, "source": snapshot.group_sources[name]}
                            for name, wells in snapshot.groups.items()},
            "data_windows": [window.model_dump() for window in unified.data_windows or []],
            "protocol_steps": [step.model_dump() for step in snapshot.protocol],
            "analysis_context": context.model_dump(mode="json"),
            "scope": "whole-run", "raw_coordinate_basis": "post-background/pre-reference",
            "passive_reference_dye": snapshot.passive_reference_label,
            "ct_conditions": {"scope": "full-curve", "use_rox": context.use_rox,
                              "background": "none", "cycles": unified.cycles},
        },
    }


def build_result_snapshot(
    session_id: str, *, user: TokenData,
    selected_cycle: int | None = None, use_rox: bool | None = None,
    background: BackgroundMode | None = None, result_revision: UUID | None = None,
    cycle_mode: CycleMode = "legacy_latest",
) -> dict:
    snapshot, launch = _capture_asg(
        session_id, user, ExportOptions(result_revision, selected_cycle, use_rox, background, cycle_mode),
    )
    return _render_asg(snapshot, launch)
