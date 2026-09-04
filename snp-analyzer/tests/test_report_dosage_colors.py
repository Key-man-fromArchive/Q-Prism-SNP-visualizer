"""The PDF report has to colour a polyploid plate's dosage classes.

Its genotype colour map was diploid-only -- "Allele 1 Homo" / "Heterozygous" /
"Allele 2 Homo" -- so on a hexaploid plate every class ("AAABBB", "AABBBB", ...)
missed the map and fell through to one grey default. The report showed a single
colour for what the analysis had resolved into up to nine classes, and its
plate legend named the diploid trio whatever the ploidy.

The ramp itself is documented in app/reporting/charts.py and mirrored in
frontend/src/lib/genotype.ts; the last test here is what keeps the two copies
from drifting apart.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.processing.genotype_vocab import genotype_labels
from app.reporting.charts import (
    CONTROL_COLORS,
    dosage_palette,
    genotype_color,
)

PLOIDIES = [2, 3, 4, 5, 6, 7, 8]
_FRONTEND = (
    Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib" / "genotype.ts"
)


@pytest.mark.parametrize("ploidy", PLOIDIES)
def test_every_dosage_class_gets_its_own_colour(ploidy):
    palette = dosage_palette(ploidy)
    assert len(palette) == ploidy + 1
    assert len(set(palette)) == ploidy + 1


@pytest.mark.parametrize("ploidy", PLOIDIES)
def test_every_label_this_ploidy_can_produce_resolves(ploidy):
    """The bug in one line: a label the caller can legitimately assign must not
    fall through to the default."""
    for label in genotype_labels(ploidy):
        assert genotype_color(label, ploidy) is not None, label


def test_the_diploid_report_colours_do_not_change():
    assert dosage_palette(2) == ["#dc2626", "#16a34a", "#2563eb"]


def test_the_controls_are_still_resolved_and_are_not_dosage_colours():
    for label, color in CONTROL_COLORS.items():
        assert genotype_color(label, 6) == color
        assert color not in dosage_palette(6)


def test_an_unknown_label_is_reported_as_unknown_not_silently_coloured():
    # The caller supplies the fallback, so it can differ per chart (a scatter
    # point vs an empty plate cell).
    assert genotype_color("not a genotype", 6) is None


@pytest.mark.parametrize("ploidy", [4, 6, 8])
def test_the_balanced_class_of_an_even_ploidy_is_green(ploidy):
    assert dosage_palette(ploidy)[ploidy // 2] == "#10b981"


@pytest.mark.parametrize("ploidy", [3, 5, 7])
def test_an_odd_ploidy_has_no_balanced_class(ploidy):
    assert "#10b981" not in dosage_palette(ploidy)


@pytest.mark.parametrize("ploidy", PLOIDIES)
def test_the_report_ramp_matches_the_frontend_ramp(ploidy):
    """Two copies of one palette: the report and the on-screen plot must agree,
    or an exported PDF contradicts the screen it was exported from."""
    source = _FRONTEND.read_text()

    def arm(name: str) -> list[str]:
        match = re.search(rf"const {name} = \[(.*?)\];", source, re.S)
        assert match, f"{name} not found in {_FRONTEND.name}"
        return re.findall(r"#[0-9a-f]{6}", match.group(1))

    red, blue = arm("RED_ARM_LIGHT"), arm("BLUE_ARM_LIGHT")

    def steps(a: list[str], n: int) -> list[str]:
        if n <= 0:
            return []
        if n == 1:
            return [a[0]]
        return [a[round(i * (len(a) - 1) / (n - 1))] for i in range(n)]

    if ploidy == 2:
        # Diploid is special-cased on both sides; only the midpoint differs
        # (the report renders on white paper and uses a darker green).
        expected = ["#dc2626", "#16a34a", "#2563eb"]
    else:
        even = ploidy % 2 == 0
        per_arm = ploidy // 2 if even else (ploidy + 1) // 2
        low = steps(red, per_arm)
        high = list(reversed(steps(blue, per_arm)))
        expected = [*low, "#10b981", *high] if even else [*low, *high]

    assert dosage_palette(ploidy) == expected
