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


def test_empty_returns_empty():
    assert cluster_auto([], ntc_threshold=0.1) == {}
