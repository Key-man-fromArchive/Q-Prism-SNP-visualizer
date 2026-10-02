"""Regenerate the synthetic StepOnePlus fixtures used by the E2E specs.

Run with the contract venv python from the worktree root:
    python tests/fixtures/stepone/make_fixtures.py
Values are invented; nothing here derives from a customer file.
"""

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "snp-analyzer" / "tests"))

from stepone_fixtures import StepOneOptions, default_markers, write_stepone_eds  # noqa: E402

write_stepone_eds(HERE / "stepone-partial-names.eds", StepOneOptions())
write_stepone_eds(
    HERE / "stepone-user-names.eds",
    StepOneOptions(markers=default_markers("user")),
)
