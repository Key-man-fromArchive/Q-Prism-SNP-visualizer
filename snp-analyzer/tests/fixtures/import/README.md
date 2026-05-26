# qPCR Import Fixtures

These fixtures support the Phase P0 import-expansion test surface. They are synthetic, anonymized, deterministic, and intentionally small so future parser tests can assert structure without depending on instrument exports.

## Layout

| Path | Purpose |
| --- | --- |
| `generic_long/` | Valid long-table fixtures with explicit `well,cycle,dye,role,rfu` columns. |
| `generic_wide/` | Valid channel-neutral wide-table fixtures plus `.mapping.json` sidecars. |
| `rdes_extension/` | Valid Q-Prism RDES-extension fixtures with a `Role` column. |
| `strict_rdes/` | Strict RDES fixture without `Role`; it must route to mapping preview. |
| `invalid/` | Negative and recovery fixtures grouped by parser family. |
| `rdml/` | RDML public source notes placeholder; no third-party RDML data is committed in P0. |

The broader coverage table and public source provenance are documented in `docs/import-fixtures.md`.
