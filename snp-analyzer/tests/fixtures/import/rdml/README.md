# RDML Smoke Fixture Notes

The RDML fixtures in this directory are synthetic, minimal, and generated for parser tests only. They do not contain third-party instrument exports or sample identifiers.

- `wt_mt.rdml`: single-run WT/MT raw amplification fixture.
- `multi_run.rdml`: two-run fixture that requires explicit run selection.
- `missing_raw_curves.rdml`: endpoint-only data that must fail mapped import.
- `qiagen_rotor_gene.rdml`: synthetic Rotor-Gene metadata used to test non-authoritative vendor presets.
