"""No-amplification well detection from the Pre-read -> read signal rise.

Contract stub (P7-C0); the algorithm is implemented by P7-A.

Per well and channel: dRn = (dye/ROX at the read cycle) - (dye/ROX at the
Pre-read). The automatic channel threshold is ``fraction`` times the value at
the top 10% of the positive dRn values across the whole plate; a manual
threshold in the config replaces it for that channel. A well with both
channels below their thresholds is "no amplification".
"""
from app.models import AmplificationQcConfig, AmplificationQcResult, UnifiedData


def compute_amplification_qc(
    unified: UnifiedData,
    cycle: int,
    wells: list[str],
    config: AmplificationQcConfig,
) -> AmplificationQcResult:
    """Stub: reports QC as unavailable with no flagged wells."""
    return AmplificationQcResult(
        enabled=config.enabled,
        available=False,
        fraction=config.fraction,
        fam_threshold=None,
        allele2_threshold=None,
        source="off",
        baseline_cycle=None,
        read_cycle=None,
        no_amplification_wells=[],
    )
