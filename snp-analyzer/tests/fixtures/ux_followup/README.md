# Synthetic UX follow-up fixtures

Import `make_ux_plate`, `make_ux_markers`, and `make_ux_endpoint` from
`fixtures_ux_followup` in backend tests. Every call returns independent models;
there is no random seed, filesystem write, database, network, or private input.

The plate has 96 (`A1`–`H12`) or 384 (`A1`–`P24`) wells and absolute cycles
0–41: pre-read 0, amplification 1–40, post-read 41. A1 raw reporters are
`10 + 4*cycle`, `20 + 2*cycle`; reference is 10. The final two wells are NTCs
at (2, 2), except named variants. Two markers have ploidies 2/6 and leave the
last four wells unassigned; callers can independently mark Empty/Omit wells.

`manifest.json` contains literal A1 arithmetic expectations for 20/40 cycles,
ROX on/off, and supported pre-read background. Endpoint-only channel-min
expectations are raw (168, 98), normalized (16.8, 9.8) at cycle 40. No reference
means raw coordinates even when normalization is requested.

NTC expectations describe the planned structured contract at cycle 40 with
manual NTC types from `imported_well_types`. They do not assert that the old
API already implements missing/insufficient states. Tests verify the underlying
signal evidence without copying or changing production scientific thresholds.
Failure event lists are deterministic schedules for later API/browser tests,
not timing sleeps or implementations of concurrency protection.

`legacy_result.json` is an intentionally context-free historical wire payload;
labels/confidences are hand-authored serialization inputs, not biological ground
truth. Future tests must require `legacy_unknown` and blocked verified export.

Run: `venv/bin/python -m pytest tests/test_ux_fixtures.py --tb=short -q`.
