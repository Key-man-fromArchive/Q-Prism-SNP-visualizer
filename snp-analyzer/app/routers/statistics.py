"""Statistics API router -- allele frequency and HWE."""
from fastapi import APIRouter, HTTPException

from app.routers.upload import sessions
from app.routers.clustering import cluster_store, welltype_store
from app.processing.genotype import get_effective_types, count_genotypes
from app.processing.statistics import allele_frequencies, hwe_test
from app.auth import CurrentUser, check_session_access

router = APIRouter()


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

    return {
        "allele_frequency": freq,
        "hwe": hwe,
        "genotype_distribution": distribution,
        "total_wells": len(unified.wells),
    }
