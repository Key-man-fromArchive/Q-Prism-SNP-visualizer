# qPCR Import Fixture Coverage

Phase P0 adds synthetic, committed import fixtures for generic long, generic wide, Q-Prism RDES extension, strict RDES, and invalid parser cases. The files are deliberately small, use `Sample_01`/`SNP1`, and contain no private sample identifiers or instrument exports.

## Static Templates

| Template | Static path | Structure | Notes |
| --- | --- | --- | --- |
| Q-Prism RDES amplification TSV | `snp-analyzer/app/static/templates/qprism-rdes-amplification-template.tsv` | `Well`, sample metadata, `Dye`, `Role`, `Cq`, cycle columns | Q-Prism RDES extension, not strict RDES. |
| Generic long CSV | `snp-analyzer/app/static/templates/qprism-generic-long-template.csv` | `well,cycle,dye,role,rfu,sample,target,sample_type` | Explicit role per fluorescence row. |
| Generic wide CSV | `snp-analyzer/app/static/templates/qprism-generic-wide-template.csv` | `well,cycle,ch1_rfu,ch2_rfu,ch3_rfu,ch4_rfu,sample,target` | Requires channel-to-role mapping before import. |

Template files are machine-readable and contain no comment rows.

## Fixture Coverage Table

| Parser path | Valid committed cases | Invalid/recovery committed cases | Fixture location |
| --- | --- | --- | --- |
| Generic long | WT/MT, WT/MT with passive-reference normalization, WT/MT1/MT2, WT/MT1/MT2/MT3 | Missing required role, malformed well, duplicate `(well, cycle, channel)`, decimal comma with semicolon delimiter, Cq-only | `snp-analyzer/tests/fixtures/import/generic_long/`, `snp-analyzer/tests/fixtures/import/invalid/generic_long/` |
| Generic wide | WT/MT, WT/MT with passive-reference normalization, WT/MT1/MT2, WT/MT1/MT2/MT3 with mapping sidecars | Missing mapping config, duplicate role binding, missing normalization channel | `snp-analyzer/tests/fixtures/import/generic_wide/`, `snp-analyzer/tests/fixtures/import/invalid/generic_wide/` |
| Q-Prism RDES extension | WT/MT, WT/MT with passive-reference normalization, WT/MT1/MT2 | Malformed cycle columns, inconsistent cycle count, missing RFU | `snp-analyzer/tests/fixtures/import/rdes_extension/`, `snp-analyzer/tests/fixtures/import/invalid/rdes_extension/` |
| Strict RDES | Mapping-required preview only | Direct auto-import blocked expectation | `snp-analyzer/tests/fixtures/import/strict_rdes/`, `snp-analyzer/tests/fixtures/import/invalid/strict_rdes/` |
| RDML | Public source notes only in P0 | Future parser tests should cover multi-run selection, missing raw curves, and unsupported channel sets | `snp-analyzer/tests/fixtures/import/rdml/README.md` |

## Public RDML/Roche Source Notes

These are source candidates for future smoke fixtures. CI should not depend on unavailable local paths or network downloads.

| Source | Public notes | P0 decision |
| --- | --- | --- |
| RDML R package, `PCRuniversum/RDML` (`https://github.com/PCRuniversum/RDML`, `https://pcruniversum.github.io/RDML/articles/RDML.html`, `https://www.rdocumentation.org/packages/RDML`) | The RDML package repository is public and its docs describe a built-in Roche LightCycler 96 example file named `lc96_bACTXY.rdml` with FAM, Hex, Texas Red, and Cy5 dyes. The package is listed with `MIT + file LICENSE` on RDocumentation/CRAN metadata. | Do not vendor in P0; record as a candidate Roche multi-channel smoke source pending pinned-file attribution. |
| RDML-Tools / RDML-Python (`https://rdml.org/referenceImplement.html`) | RDML.org documents RDML-Tools and RDML-Python as reference implementations; RDML-Tools are GPL licensed and source is public on GitHub. | Use as a behavioral reference or optional local validator. Do not copy GPL assets into committed parser fixtures without explicit attribution and license review. |
| `ropensci/tidyqpcr` (`https://github.com/ropensci/tidyqpcr`) | The project documents Roche LightCycler single-colour raw/Cq readers and RDML-compatible metadata handling. | Treat as a Roche single-channel/SYBR smoke reference only; it does not prove SNP multi-channel import behavior. |

## Provenance

- Synthetic fixtures and templates were authored for this repository during Phase P0.
- They are deterministic static files, not derived from patient, customer, or vendor-exported sample data.
- RDES template structure follows the Q-Prism import expansion plan in `docs/qpcr-import-expansion-plan.md`.
- Public RDML/Roche references are documented as candidate sources, not committed binary/test dependencies.
