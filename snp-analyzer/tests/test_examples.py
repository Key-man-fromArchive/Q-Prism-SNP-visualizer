"""Synthetic example datasets (2x–8x) for the 'load example' dropdown."""
from collections import Counter

import pytest

from app.examples import build_example, list_examples
from app.models import MarkerRegion
from app.processing.clustering import cluster_auto
from app.processing.normalize import normalize_for_cycle
from app.routers.clustering import _validate_marker_set


def test_list_examples_covers_2x_to_8x():
    ploidies = [e["ploidy"] for e in list_examples()]
    assert ploidies == [2, 3, 4, 5, 6, 7, 8]


@pytest.mark.parametrize("ploidy", [2, 3, 4, 5, 6, 7, 8])
def test_build_example_structure(ploidy):
    u = build_example(ploidy)
    assert u.ploidy == ploidy
    assert u.has_rox and u.cycles == list(range(1, 41))
    assert "NTC" in (u.sample_names or {}).values()
    # signal wells cover every dosage class d/ploidy ("Empty" = the rest of the
    # physical 96-well plate this demo assay doesn't use — see
    # test_build_example_registers_full_plate)
    labels = {v for v in u.sample_names.values() if v not in ("NTC", "Empty")}
    assert len(labels) == ploidy + 1
    assert len(u.wells) <= 96


def _endpoint_points(u):
    # Mirrors production: clustering is always scoped to a single marker's own
    # wells (see app/routers/clustering.py), never blindly to the whole
    # physical plate — so the unused "Empty" filler wells added to round the
    # example out to a full 96-well plate are excluded here, same as a real
    # marker definition would never include them.
    pts = normalize_for_cycle(u, 40)
    empty = {w for w, name in (u.sample_names or {}).items() if name == "Empty"}
    return [
        {"well": p.well, "norm_fam": p.norm_fam, "norm_allele2": p.norm_allele2}
        for p in pts
        if p.well not in empty
    ]


@pytest.mark.parametrize("ploidy", [2, 3, 4])
def test_example_resolves_all_dosage_classes(ploidy):
    # Low ploidy examples are cleanly separable -> all P+1 dosage classes called.
    u = build_example(ploidy)
    assign, _ = cluster_auto(_endpoint_points(u), ploidy=ploidy)
    called = {v for v in assign.values() if v not in ("NTC", "Undetermined")}
    assert len(called) == ploidy + 1, f"{ploidy}x -> {Counter(assign.values())}"
    assert Counter(assign.values())["NTC"] >= 1


@pytest.mark.parametrize("ploidy", [2, 3, 4, 5, 6, 7, 8])
def test_build_example_registers_full_plate(ploidy):
    # A real .pcrd plate always has all 96 wells; the frontend's Plate Setup
    # grid renders the full plate, so a whole-column selection (e.g. col-header-5
    # -> A5..H5) must be valid against every example, not just high-ploidy ones
    # that happen to nearly fill the plate.
    u = build_example(ploidy)
    expected = [f"{r}{c}" for r in "ABCDEFGH" for c in range(1, 13)]
    assert sorted(u.wells) == sorted(expected)
    assert len(u.wells) == 96


@pytest.mark.parametrize("ploidy", [2, 3, 4, 5, 6, 7, 8])
def test_example_full_column_marker_validates(ploidy):
    # Selecting a whole plate column (as the E2E "define markers" step does)
    # must not 400 with "well not part of plate", regardless of ploidy.
    u = build_example(ploidy)
    column_5 = [f"{r}5" for r in "ABCDEFGH"]
    marker = MarkerRegion(id="m1", name="Marker 1", wells=column_5, ploidy=ploidy)
    _validate_marker_set([marker], u)  # must not raise
