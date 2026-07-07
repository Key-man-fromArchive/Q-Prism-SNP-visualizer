"""Tests for data-driven, rank-based genotype clustering (cluster_auto).

Heterozygotes can cluster off-center (e.g. ratio ~0.62 instead of 0.5) because
dye efficiencies differ. Fixed ratio thresholds (>0.6 -> Allele 1) then
misclassify those hets as a homozygote. cluster_auto must still call them Het.
"""

from collections import Counter

from app.processing.clustering import cluster_auto


def _points():
    pts = []
    # Allele 1 homozygous: fam-dominant (ratio ~0.92)
    for i in range(10):
        j = i * 0.002
        pts.append({"well": f"A{i}", "norm_fam": 0.92 + j, "norm_allele2": 0.08 + j})
    # Heterozygous SKEWED toward fam (ratio ~0.62 — above the classic 0.6 cutoff)
    for i in range(10):
        j = i * 0.002
        pts.append({"well": f"H{i}", "norm_fam": 0.62 + j, "norm_allele2": 0.38 + j})
    # Allele 2 homozygous: allele2-dominant (ratio ~0.30)
    for i in range(10):
        j = i * 0.002
        pts.append({"well": f"B{i}", "norm_fam": 0.30 + j, "norm_allele2": 0.70 + j})
    # NTC: near-zero total signal
    for i in range(3):
        pts.append({"well": f"N{i}", "norm_fam": 0.02, "norm_allele2": 0.02})
    return pts


def test_skewed_hets_are_not_called_allele1():
    assign = cluster_auto(_points(), ntc_threshold=0.1)

    # Every het well (ratio ~0.62) must be Heterozygous, not Allele 1 Homo
    for i in range(10):
        assert assign[f"H{i}"] == "Heterozygous", f"H{i} -> {assign[f'H{i}']}"

    # Homozygotes and NTC land correctly
    assert all(assign[f"A{i}"] == "Allele 1 Homo" for i in range(10))
    assert all(assign[f"B{i}"] == "Allele 2 Homo" for i in range(10))
    assert all(assign[f"N{i}"] == "NTC" for i in range(3))


def test_auto_cluster_counts():
    counts = Counter(cluster_auto(_points(), ntc_threshold=0.1).values())
    assert counts["Allele 1 Homo"] == 10
    assert counts["Heterozygous"] == 10
    assert counts["Allele 2 Homo"] == 10
    assert counts["NTC"] == 3


def test_weak_outlier_is_undetermined_not_forced_into_a_cluster():
    """A weak reaction far from every cluster (but above the NTC floor) must be
    Undetermined rather than force-assigned to the nearest genotype."""
    pts = _points()
    # Low-signal well near the origin: above NTC floor, far from all 3 clusters.
    pts.append({"well": "OUT", "norm_fam": 0.15, "norm_allele2": 0.05})

    assign = cluster_auto(pts, ntc_threshold=0.1)
    assert assign["OUT"] == "Undetermined", assign["OUT"]
    # The real clusters are unaffected.
    assert all(assign[f"H{i}"] == "Heterozygous" for i in range(10))
    assert all(assign[f"A{i}"] == "Allele 1 Homo" for i in range(10))


def test_monomorphic_plate_is_not_split_into_false_genotypes():
    """A plate with a single genotype (all Allele 1) must not be split by
    KMeans noise into invented Het/Allele 2 calls."""
    pts = [
        {
            "well": f"W{i}",
            "norm_fam": 0.90 + ((i * 7) % 13 - 6) * 0.004,
            "norm_allele2": 0.08 + ((i * 5) % 11 - 5) * 0.003,
        }
        for i in range(40)
    ]
    counts = Counter(cluster_auto(pts, ntc_threshold=0.1).values())
    assert counts.get("Allele 2 Homo", 0) == 0
    assert counts.get("Heterozygous", 0) == 0
    assert counts["Allele 1 Homo"] == 40


def test_partial_spectrum_het_not_called_homozygote():
    """Allele 1 + Het only (no Allele 2 present): the het cluster must stay Het,
    not be rank-labeled as the missing Allele 2 homozygote."""
    pts = [{"well": f"A{i}", "norm_fam": 0.92, "norm_allele2": 0.08} for i in range(15)]
    pts += [{"well": f"H{i}", "norm_fam": 0.60, "norm_allele2": 0.40} for i in range(15)]
    counts = Counter(cluster_auto(pts, ntc_threshold=0.1).values())
    assert counts.get("Allele 2 Homo", 0) == 0
    assert counts["Allele 1 Homo"] == 15
    assert counts["Heterozygous"] == 15


def test_empty_returns_empty():
    assert cluster_auto([], ntc_threshold=0.1) == {}
