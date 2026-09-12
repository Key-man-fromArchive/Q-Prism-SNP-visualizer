"""P4-R1-T1: analysis warning severity grading contract.

FB-03 (feedback-2026-09-11) wants low-signal "analysis warnings" demoted to
the bottom of the results screen -- but demoting a warning that speaks to
call *reliability* (not just cosmetics) would hide something the operator
needs to see. This introduces a two-tier severity so the UI can tell the two
apart:

  * ``blocking``  -- bears on genotype-call reliability; the UI must keep it
    where it will be seen (not demoted below the fold).
  * ``advisory``  -- informational; safe to demote.

All THREE codes the backend currently emits (``relative_ntc``, ``low_n``,
``anchor_conflict``) are classified ``blocking`` here -- see
``app/models.py::WARNING_SEVERITY`` for the per-code rationale. No existing
warning is demoted by this task; that would be a QC policy call for the user,
not something to infer silently.

Backward compatibility is the other half of the contract: ``warnings``
(``list[str] | None``) is untouched. Any consumer that only reads
``warnings`` and ignores the new ``warning_details`` field keeps working
exactly as before -- this is asserted directly below.
"""

from __future__ import annotations

from app.models import (
    WARNING_SEVERITY,
    ClusteringResult,
    RegionResult,
    WarningDetail,
)


def test_known_codes_are_all_blocking():
    """The three codes the backend actually emits today
    (clustering.py:360, :385, :838) all bear on call reliability and must not
    be silently demoted by this task."""
    assert WARNING_SEVERITY["relative_ntc"] == "blocking"
    assert WARNING_SEVERITY["low_n"] == "blocking"
    assert WARNING_SEVERITY["anchor_conflict"] == "blocking"


def test_clustering_result_warning_details_have_severity():
    result = ClusteringResult(
        algorithm="threshold",
        cycle=6,
        assignments={"A1": "AA"},
        warnings=["relative_ntc", "low_n"],
    )
    assert result.warning_details == [
        WarningDetail(code="relative_ntc", severity="blocking"),
        WarningDetail(code="low_n", severity="blocking"),
    ]


def test_region_result_warning_details_have_severity():
    region = RegionResult(
        id="m1",
        name="Marker 1",
        wells=["A1"],
        ploidy=2,
        assignments={"A1": "AA"},
        warnings=["anchor_conflict"],
    )
    assert region.warning_details == [
        WarningDetail(code="anchor_conflict", severity="blocking"),
    ]


def test_unknown_code_defaults_to_blocking():
    """An unrecognised diagnostic code should not be silently hidden by a
    future demotion feature -- default new/unknown codes to the safer tier."""
    result = ClusteringResult(
        algorithm="threshold",
        cycle=6,
        assignments={},
        warnings=["some_future_code"],
    )
    assert result.warning_details == [
        WarningDetail(code="some_future_code", severity="blocking"),
    ]


def test_no_warnings_gives_none_not_empty_list():
    """Mirrors the existing ``warnings`` contract: a clean run's JSON should
    stay unchanged (``None``, not ``[]``)."""
    result = ClusteringResult(algorithm="threshold", cycle=6, assignments={})
    assert result.warnings is None
    assert result.warning_details is None


def test_legacy_consumer_reading_only_warnings_list_is_unaffected():
    """Backward compatibility: a consumer that reads ``warnings`` and has
    never heard of ``warning_details`` must see byte-for-byte the same
    ``warnings`` value as before this task."""
    result = ClusteringResult(
        algorithm="threshold",
        cycle=6,
        assignments={"A1": "AA"},
        warnings=["relative_ntc"],
    )
    assert result.warnings == ["relative_ntc"]
    dumped = result.model_dump()
    assert dumped["warnings"] == ["relative_ntc"]
