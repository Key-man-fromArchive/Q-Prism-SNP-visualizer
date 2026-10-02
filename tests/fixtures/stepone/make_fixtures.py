"""Regenerate the synthetic StepOnePlus fixtures used by the E2E specs.

Run with the contract venv python from the worktree root:
    python tests/fixtures/stepone/make_fixtures.py
Values are invented; nothing here derives from a customer file.
"""

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "snp-analyzer" / "tests"))

import stepone_fixtures  # noqa: E402
from stepone_fixtures import (  # noqa: E402
    PLATE_COLS,
    StepOneOptions,
    default_markers,
    write_stepone_eds,
)

write_stepone_eds(HERE / "stepone-partial-names.eds", StepOneOptions())
write_stepone_eds(
    HERE / "stepone-user-names.eds",
    StepOneOptions(markers=default_markers("user")),
)

# Run in which marker QPrism2 (columns 3-4) never amplifies and well A1 of marker
# QPrism1 is flat too: both reporters stay at the baseline for every read.
FLAT_COLUMNS = {2, 3}  # zero-based
FLAT_WELLS = {0}  # A1
_signal = stepone_fixtures._signal


def _flat_signal(well_idx, read, reads, dye, rng, options):
    column = well_idx % PLATE_COLS
    if dye != "ROX" and (column in FLAT_COLUMNS or well_idx in FLAT_WELLS):
        return 800.0 + rng.uniform(-15.0, 15.0)
    return _signal(well_idx, read, reads, dye, rng, options)


stepone_fixtures._signal = _flat_signal
write_stepone_eds(HERE / "stepone-no-amplification.eds", StepOneOptions())
stepone_fixtures._signal = _signal
