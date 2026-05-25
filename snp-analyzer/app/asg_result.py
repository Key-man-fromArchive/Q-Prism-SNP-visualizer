"""Build compact SNP result snapshots for ASG Designer persistence."""
from __future__ import annotations

from fastapi import HTTPException

from app.asg_session import get_session_asg_launch
from app.processing.ct_calculation import calculate_all_ct
from app.processing.genotype import count_genotypes, get_effective_types
from app.processing.normalize import normalize_for_cycle
from app.processing.statistics import allele_frequencies, hwe_test
from app.routers.clustering import cluster_store, group_store, welltype_store
from app.routers.data import protocol_store
from app.routers.sample import sample_name_store
from app.routers.upload import sessions


def build_result_snapshot(
    session_id: str,
    *,
    selected_cycle: int | None = None,
    use_rox: bool = True,
) -> dict:
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    launch = get_session_asg_launch(session_id)
    if launch is None:
        raise HTTPException(status_code=409, detail="Session is not linked to an ASG launch")
    if not launch.allows_save():
        raise HTTPException(status_code=403, detail="ASG launch does not allow saving results")

    unified = sessions[session_id]
    cycle = selected_cycle if selected_cycle and selected_cycle > 0 else _default_cycle(session_id)
    if cycle not in unified.cycles:
        raise HTTPException(
            status_code=400,
            detail=f"Cycle {cycle} not available. Range: {unified.cycles[0]}-{unified.cycles[-1]}",
        )

    cluster = cluster_store.get(session_id)
    cluster_assignments = cluster.assignments if cluster else {}
    manual_assignments = welltype_store.get(session_id, {})
    effective_types = get_effective_types(cluster_assignments, manual_assignments, unified.wells)
    genotype_counts = count_genotypes(effective_types)
    sample_names = _merged_sample_names(session_id)
    selected_points = normalize_for_cycle(unified.data, cycle, unified.has_rox, use_rox)
    ct_results = calculate_all_ct(unified, use_rox) if len(unified.cycles) >= 3 else {}

    wells = []
    for point in selected_points:
        ct = ct_results.get(point.well, {})
        wells.append(
            {
                "well": point.well,
                "sample_name": sample_names.get(point.well),
                "norm_fam": point.norm_fam,
                "norm_allele2": point.norm_allele2,
                "raw_fam": point.raw_fam,
                "raw_allele2": point.raw_allele2,
                "raw_rox": point.raw_rox,
                "auto_cluster": cluster_assignments.get(point.well),
                "manual_type": manual_assignments.get(point.well),
                "effective_type": effective_types.get(point.well, "Unknown"),
                "fam_ct": ct.get("fam_ct"),
                "allele2_ct": ct.get("allele2_ct"),
            }
        )

    return {
        "schema_version": 1,
        "launch": {
            "id": launch.launch_id,
            "save_token": launch.save_token,
        },
        "session_id": session_id,
        "file": _file_metadata(session_id),
        "instrument": {
            "name": unified.instrument,
            "allele2_dye": unified.allele2_dye,
            "has_rox": unified.has_rox,
            "num_wells": len(unified.wells),
            "num_cycles": len(unified.cycles),
        },
        "selected_cycle": cycle,
        "summary": {
            "genotype_counts": genotype_counts,
            "allele_frequency": allele_frequencies(
                genotype_counts["AA"],
                genotype_counts["AB"],
                genotype_counts["BB"],
            ),
            "hwe": hwe_test(
                genotype_counts["AA"],
                genotype_counts["AB"],
                genotype_counts["BB"],
            ),
            "total_wells": len(unified.wells),
            "cluster_algorithm": cluster.algorithm if cluster else None,
            "cluster_cycle": cluster.cycle if cluster else None,
        },
        "result": {
            "asg_target": {
                "target_type": launch.target_type,
                "target_id": launch.target_id,
                "context": launch.context,
            },
            "wells": wells,
            "clustering": {
                "algorithm": cluster.algorithm if cluster else None,
                "cycle": cluster.cycle if cluster else None,
                "assignments": cluster_assignments,
            },
            "manual_welltypes": manual_assignments,
            "sample_names": sample_names,
            "well_groups": _merged_well_groups(session_id),
            "data_windows": [w.model_dump() for w in unified.data_windows] if unified.data_windows else [],
            "protocol_steps": [s.model_dump() for s in _protocol_steps(session_id)],
        },
    }


def _default_cycle(session_id: str) -> int:
    cluster = cluster_store.get(session_id)
    if cluster and cluster.cycle > 0:
        return cluster.cycle
    return max(sessions[session_id].cycles)


def _merged_sample_names(session_id: str) -> dict[str, str]:
    unified = sessions[session_id]
    names = dict(unified.sample_names or {})
    names.update(sample_name_store.get(session_id, {}))
    return names


def _merged_well_groups(session_id: str) -> dict[str, dict]:
    unified = sessions[session_id]
    groups: dict[str, dict] = {}
    for name, wells in (unified.well_groups or {}).items():
        groups[name] = {"wells": wells, "source": "parsed"}
    for name, wells in group_store.get(session_id, {}).items():
        groups[name] = {"wells": wells, "source": "manual"}
    return groups


def _protocol_steps(session_id: str):
    unified = sessions[session_id]
    if session_id in protocol_store:
        return protocol_store[session_id]
    return unified.protocol_steps or []


def _file_metadata(session_id: str) -> dict[str, str]:
    try:
        from app.db import get_db

        row = get_db().execute(
            "SELECT raw_filename FROM sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
    except Exception:
        row = None
    return {
        "name": (row["raw_filename"] if row else "") or "",
        "sha256": "",
    }
