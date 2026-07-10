"""Synthetic example datasets (2x–8x) for the 'load example' dropdown."""
from collections import Counter

import pytest

from app.examples import build_example, list_examples
from app.processing.clustering import cluster_auto
from app.processing.normalize import normalize_for_cycle


def test_list_examples_covers_2x_to_8x():
    ploidies = [e["ploidy"] for e in list_examples()]
    assert ploidies == [2, 3, 4, 5, 6, 7, 8]


@pytest.mark.parametrize("ploidy", [2, 3, 4, 5, 6, 7, 8])
def test_build_example_structure(ploidy):
    u = build_example(ploidy)
    assert u.ploidy == ploidy
    assert u.has_rox and u.cycles == [1, 40]
    assert "NTC" in (u.sample_names or {}).values()
    # signal wells cover every dosage class d/ploidy
    labels = {v for v in u.sample_names.values() if v != "NTC"}
    assert len(labels) == ploidy + 1
    assert len(u.wells) <= 96


def _endpoint_points(u):
    pts = normalize_for_cycle(u, 40)
    return [{"well": p.well, "norm_fam": p.norm_fam, "norm_allele2": p.norm_allele2} for p in pts]


@pytest.mark.parametrize("ploidy", [2, 3, 4])
def test_example_resolves_all_dosage_classes(ploidy):
    # Low ploidy examples are cleanly separable -> all P+1 dosage classes called.
    u = build_example(ploidy)
    assign, _ = cluster_auto(_endpoint_points(u), ploidy=ploidy)
    called = {v for v in assign.values() if v not in ("NTC", "Undetermined")}
    assert len(called) == ploidy + 1, f"{ploidy}x -> {Counter(assign.values())}"
    assert Counter(assign.values())["NTC"] >= 1
