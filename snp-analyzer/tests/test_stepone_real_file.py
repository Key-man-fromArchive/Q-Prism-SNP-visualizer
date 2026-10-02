"""Customer StepOnePlus file check; skipped unless ``QPRISM_STEPONE_EDS`` is set.

The file stays outside the repository and is only read here. Expected values
come from the approved plan (overview section 5).
"""

import os
from pathlib import Path

import pytest

from app.parsers.detector import detect_and_parse
from app.processing.ntc_detection import compute_suggested_cycle

_PATH = os.environ.get("QPRISM_STEPONE_EDS")

pytestmark = pytest.mark.skipif(
    not _PATH or not Path(_PATH).is_file(),
    reason="QPRISM_STEPONE_EDS not set to an existing file",
)


@pytest.fixture(scope="module")
def parsed():
    return detect_and_parse(_PATH, Path(_PATH).name)


def test_a1_post_read_rn(parsed):
    post = next(p for p in parsed.data if p.well == "A1" and p.cycle == 7)
    # Plan values "0.4106 / 0.8811" are VIC/ROX and FAM/ROX of A1 post-read.
    assert post.allele2 / post.rox == pytest.approx(0.4106, abs=5e-4)
    assert post.fam / post.rox == pytest.approx(0.8811, abs=5e-4)


def test_layout_and_labels(parsed):
    assert parsed.cycles == [1, 2, 3, 4, 5, 6, 7]
    assert len(parsed.wells) == 96
    assert len(parsed.imported_markers) == 6
    assert all(len(w) == 16 for w in parsed.imported_markers.values())
    assert parsed.read_labels[2].pcr_cycle == 36
    assert parsed.read_labels[2].temperature == 40.0


def test_first_screen_cycle_and_qprism1_names(parsed):
    assert compute_suggested_cycle(parsed) == 2
    labels = parsed.imported_marker_alleles["QPrism1"]
    assert (labels.fam, labels.allele2) == ("WT", "MT")
