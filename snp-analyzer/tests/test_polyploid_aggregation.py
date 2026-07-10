"""Phase 3 — ploidy-aware aggregation (genotype fallbacks + counts)."""
from types import SimpleNamespace

from app.processing.genotype import count_genotypes


def _pt(fam, allele2):
    return SimpleNamespace(norm_fam=fam, norm_allele2=allele2)


def test_export_fallback_is_ploidy_aware():
    from app.routers.export import _determine_genotype, _undetermined_min

    # No manual / no auto -> ploidy-aware ratio fallback (tetraploid dosage label).
    gt = _determine_genotype("W1", 0.9, 0.1, {}, {}, ploidy=4, undetermined_min=0.0)
    assert gt == "AAAA"  # r=0.9 -> top dosage
    gt2 = _determine_genotype("W2", 0.1, 0.9, {}, {}, ploidy=4, undetermined_min=0.0)
    assert gt2 == "BBBB"

    # Diploid unchanged
    assert _determine_genotype("W3", 0.9, 0.1, {}, {}) == "Allele 1 Homo"

    # Manual / auto still take priority over the fallback
    assert _determine_genotype("W4", 0.9, 0.1, {"W4": "NTC"}, {}, ploidy=4) == "NTC"
    assert _determine_genotype("W5", 0.9, 0.1, {}, {"W5": "AABB"}, ploidy=4) == "AABB"


def test_export_undetermined_min_is_relative():
    from app.routers.export import _determine_genotype, _undetermined_min

    pts = [_pt(0.5, 0.5) for _ in range(10)]  # median total ~1.0
    umin = _undetermined_min(pts)
    assert 0.15 < umin < 0.25  # 0.2 * median(1.0)

    # A well below the relative cutoff is Undetermined regardless of ratio.
    assert _determine_genotype("lo", 0.05, 0.05, {}, {}, ploidy=4, undetermined_min=umin) == "Undetermined"


def test_qc_fallback_is_ploidy_aware():
    from app.routers.qc import _determine_genotype

    assert _determine_genotype("W", 0.5, 0.5, {}, {}, 0.0, 4) == "AABB"
    assert _determine_genotype("W", 0.9, 0.1, {}, {}, 0.0, 2) == "Allele 1 Homo"


def test_count_genotypes_tetraploid_distribution_keys():
    eff = {"a": "AAAA", "b": "AABB", "c": "BBBB", "d": "NTC"}
    counts = count_genotypes(eff, 4)
    # dosage-keyed, no AA/AB/BB collapse
    assert counts["AAAA"] == 1 and counts["AABB"] == 1 and counts["BBBB"] == 1
    assert "AA" not in counts
    assert counts["excluded"] == 1
