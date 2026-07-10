"""Statistics API router -- allele frequency and HWE."""
from fastapi import APIRouter, HTTPException

from app.routers.upload import sessions
from app.routers.clustering import cluster_store, welltype_store
from app.processing.genotype import get_effective_types, count_genotypes
from app.processing.statistics import allele_frequencies, hwe_test
from app.auth import CurrentUser, check_session_access

router = APIRouter()


def _marker_stats(region, manual_assignments: dict[str, str]) -> dict:
    """Per-marker allele frequency / HWE / genotype distribution, scoped to a
    single region's own wells, assignments and ploidy (A2: a multi-marker
    plate's flat top-level fields are NOT authoritative -- each marker must be
    aggregated independently, using its own ploidy vocabulary)."""
    effective = get_effective_types(region.assignments, manual_assignments, region.wells)
    counts = count_genotypes(effective, region.ploidy)

    if region.ploidy == 2:
        freq = allele_frequencies(counts["AA"], counts["AB"], counts["BB"])
        hwe = hwe_test(counts["AA"], counts["AB"], counts["BB"])
    else:
        freq = allele_frequencies(0, 0, 0)
        hwe = hwe_test(0, 0, 0)

    distribution: dict[str, int] = {}
    for gt in effective.values():
        distribution[gt] = distribution.get(gt, 0) + 1

    return {
        "id": region.id,
        "name": region.name,
        "ploidy": region.ploidy,
        "allele_frequency": freq,
        "hwe": hwe,
        "genotype_distribution": distribution,
        "genotype_counts": counts,
        "total_wells": len(region.wells),
    }


@router.get("/api/data/{sid}/statistics")
async def get_statistics(sid: str, current_user: CurrentUser):
    check_session_access(sid, current_user)
    if sid not in sessions:
        raise HTTPException(404, "Session not found")
    unified = sessions[sid]

    # Get effective types
    ca = cluster_store.get(sid)
    cluster_assignments = ca.assignments if ca else {}
    manual_assignments = welltype_store.get(sid, {})

    ploidy = getattr(unified, "ploidy", 2)
    effective = get_effective_types(cluster_assignments, manual_assignments, unified.wells)
    counts = count_genotypes(effective, ploidy)

    # Allele frequency + Hardy-Weinberg are biallelic-diploid statistics; polysomic
    # population genetics is a later phase, so only compute them for diploid.
    if ploidy == 2:
        freq = allele_frequencies(counts["AA"], counts["AB"], counts["BB"])
        hwe = hwe_test(counts["AA"], counts["AB"], counts["BB"])
    else:
        freq = allele_frequencies(0, 0, 0)
        hwe = hwe_test(0, 0, 0)

    # Genotype distribution for display
    distribution = {}
    for well, gt in effective.items():
        distribution[gt] = distribution.get(gt, 0) + 1

    result = {
        "allele_frequency": freq,
        "hwe": hwe,
        "genotype_distribution": distribution,
        "total_wells": len(unified.wells),
    }

    # A2: multi-marker plate -- the flat fields above pool every marker's
    # assignments under one (legacy) plate-level ploidy and are NOT
    # authoritative. Add a per-marker breakdown, each using its own
    # region.ploidy / region.assignments. Single-marker (regions is None)
    # sessions never get this key, so their JSON is unchanged.
    if ca is not None and ca.regions:
        result["markers"] = [_marker_stats(r, manual_assignments) for r in ca.regions]

    return result
