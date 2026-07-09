"""Phase 1 — ploidy-aware model-based genotyping (cluster_auto with ploidy>2).

A tetraploid locus resolves into 5 dosage classes along the fam-fraction axis at
ideal ratios 0, 0.25, 0.5, 0.75, 1.0 -> BBBB, ABBB, AABB, AAAB, AAAA.
"""
from collections import Counter

import pytest

from app.processing.clustering import cluster_auto

# dosage -> (ideal fam-fraction, tetraploid label)
_TETRA = [
    (4, 1.00, "AAAA"),
    (3, 0.75, "AAAB"),
    (2, 0.50, "AABB"),
    (1, 0.25, "ABBB"),
    (0, 0.00, "BBBB"),
]


def _tetraploid_points(per=14, dosages=None):
    """Build a synthetic tetraploid plate. Ratios carry a small deterministic
    spread so each dosage forms a genuine cluster (not a delta)."""
    specs = [s for s in _TETRA if dosages is None or s[0] in dosages]
    pts = []
    for _d, r, label in specs:
        for i in range(per):
            rr = min(max(r + (i - per // 2) * 0.002, 0.01), 0.99)
            pts.append(
                {"well": f"{label}_{i}", "norm_fam": rr, "norm_allele2": 1.0 - rr}
            )
    return pts


def test_full_tetraploid_spectrum_all_five_dosages():
    pts = _tetraploid_points(per=14)
    assign, conf = cluster_auto(pts, ploidy=4)

    counts = Counter(assign.values())
    for _d, _r, label in _TETRA:
        assert counts[label] == 14, f"{label}: {counts[label]} (all={counts})"

    # Wells sit on their dosage centres -> confident calls, no no-calls.
    assert counts.get("Undetermined", 0) == 0
    assert conf["AABB_7"] > 0.5


def test_tetraploid_partial_spectrum_dosages_ranked_correctly():
    # Only dosages 4, 2, 0 present (AAAA / AABB / BBBB); the middle cluster must
    # be AABB (dosage 2), not a mislabelled adjacent dosage.
    pts = _tetraploid_points(per=14, dosages={4, 2, 0})
    assign, _ = cluster_auto(pts, ploidy=4)
    counts = Counter(assign.values())
    assert counts["AAAA"] == 14
    assert counts["AABB"] == 14
    assert counts["BBBB"] == 14
    assert counts.get("AAAB", 0) == 0
    assert counts.get("ABBB", 0) == 0


def test_monomorphic_tetraploid_not_split():
    # A single dosage (all AABB) must not be split into invented neighbours.
    pts = _tetraploid_points(per=30, dosages={2})
    assign, _ = cluster_auto(pts, ploidy=4)
    counts = Counter(assign.values())
    assert counts["AABB"] == 30
    assert set(counts) == {"AABB"}


def test_ntc_detected_regardless_of_ploidy():
    pts = _tetraploid_points(per=14)
    pts += [{"well": f"N{i}", "norm_fam": 0.01, "norm_allele2": 0.01} for i in range(4)]
    assign, _ = cluster_auto(pts, ploidy=4)
    assert all(assign[f"N{i}"] == "NTC" for i in range(4))


def test_invalid_ploidy_rejected():
    pts = _tetraploid_points(per=6)
    for bad in (1, 9):
        with pytest.raises(ValueError):
            cluster_auto(pts, ploidy=bad)


def test_threshold_with_boundaries_labels_by_dosage():
    # The draggable-line backend: P cuts (descending) label wells by dosage.
    from app.models import ThresholdConfig
    from app.processing.clustering import cluster_threshold

    pts = [
        {"well": "hi", "norm_fam": 0.9, "norm_allele2": 0.1},   # r=0.90 -> AAAA
        {"well": "mid", "norm_fam": 0.5, "norm_allele2": 0.5},  # r=0.50 -> AABB
        {"well": "lo", "norm_fam": 0.1, "norm_allele2": 0.9},   # r=0.10 -> BBBB
    ]
    cfg = ThresholdConfig(ntc_threshold=0.0, boundaries=[0.875, 0.625, 0.375, 0.125])
    out = cluster_threshold(pts, cfg, ploidy=4)
    assert out["hi"] == "AAAA"
    assert out["mid"] == "AABB"
    assert out["lo"] == "BBBB"


def test_threshold_without_boundaries_preserves_diploid():
    from app.models import ThresholdConfig
    from app.processing.clustering import cluster_threshold

    pts = [
        {"well": "a1", "norm_fam": 0.8, "norm_allele2": 0.2},
        {"well": "het", "norm_fam": 0.5, "norm_allele2": 0.5},
        {"well": "a2", "norm_fam": 0.2, "norm_allele2": 0.8},
    ]
    out = cluster_threshold(pts, ThresholdConfig(ntc_threshold=0.0))
    assert out["a1"] == "Allele 1 Homo"
    assert out["het"] == "Heterozygous"
    assert out["a2"] == "Allele 2 Homo"


def test_hexaploid_labels_used():
    # Sanity: hexaploid (P=6) produces 7-class labels from the vocab.
    specs = [(6, 1.0), (3, 0.5), (0, 0.0)]
    pts = []
    for _d, r in specs:
        for i in range(14):
            rr = min(max(r + (i - 7) * 0.002, 0.01), 0.99)
            pts.append({"well": f"h{_d}_{i}", "norm_fam": rr, "norm_allele2": 1 - rr})
    assign, _ = cluster_auto(pts, ploidy=6)
    counts = Counter(assign.values())
    assert counts["AAAAAA"] == 14   # dosage 6
    assert counts["AAABBB"] == 14   # dosage 3
    assert counts["BBBBBB"] == 14   # dosage 0
