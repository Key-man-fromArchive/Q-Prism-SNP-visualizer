from __future__ import annotations

import csv
from pathlib import Path

from app.assays.registry import validate_mapping_config
from app.import_errors import ImportErrorCode, ImportValidationError, make_issue, raise_import_error
from app.import_models import (
    AssayModeId,
    ImportPreview,
    ImportReading,
    ImportRole,
    ImportRun,
    MappingConfig,
    NormalizationMode,
    ReporterChannel,
    ValidationIssue,
)
from app.models import UnifiedData
from app.parsers.generic_table import (
    MAX_IMPORT_ROWS,
    _build_import_run,
    _infer_assay_mode,
    _parse_rfu,
    _parse_well,
    _raise_for_mapping_issues,
    _raise_if_issues,
    _to_duplex_unified,
)


_STRICT_RDES_HEADERS = {"well", "sample", "sample type", "target", "target type", "dye", "cq"}


class QPrismRDESParser:
    parser_id = "qprism-rdes"

    def sniff(self, file_path: Path, original_filename: str) -> bool:
        try:
            headers, _ = _read_rdes(file_path)
        except ImportValidationError:
            return False
        return _STRICT_RDES_HEADERS.issubset(set(headers))

    def preview(self, file_path: Path, original_filename: str) -> ImportPreview:
        headers, rows = _read_rdes(file_path)
        channels = []
        for row in rows[:16]:
            if "dye" in row and row["dye"]:
                channels.append(ReporterChannel(channel_id=row["dye"], dye_name=row["dye"]))
        warnings = []
        if "role" not in headers:
            warnings.append(
                make_issue(
                    ImportErrorCode.MAPPING_CONFIG_REQUIRED,
                    message="Strict RDES files without a Role column require explicit channel-to-role mapping.",
                )
            )
        return ImportPreview(
            preview_id="",
            parser_id=self.parser_id,
            filename=original_filename,
            candidate_tables=[file_path.name],
            inferred_delimiter="\t",
            decimal_separator=".",
            header_row=0,
            first_data_row=1,
            inferred_headers=headers,
            column_candidates={
                "well": ["well"] if "well" in headers else [],
                "sample": ["sample"] if "sample" in headers else [],
                "target": ["target"] if "target" in headers else [],
                "dye": ["dye"] if "dye" in headers else [],
                "rfu": [header for header in headers if header.isdigit()],
                "cycle": [header for header in headers if header.isdigit()],
                "role": ["role"] if "role" in headers else [],
            },
            sample_rows=rows[:5],
            channel_candidates=channels,
            assay_mode_candidates=[
                AssayModeId.WT_MT,
                AssayModeId.WT_MT1_MT2,
                AssayModeId.WT_MT1_MT2_MT3,
            ],
            warnings=warnings,
        )

    def parse(
        self,
        file_path: Path,
        original_filename: str,
        mapping_config: MappingConfig | None = None,
    ) -> ImportRun:
        headers, rows = _read_rdes(file_path)
        if "role" not in headers:
            raise_import_error(ImportErrorCode.MAPPING_CONFIG_REQUIRED)

        cycle_columns = [header for header in headers if header not in _STRICT_RDES_HEADERS and header != "role"]
        if not cycle_columns or any(not column.isdigit() for column in cycle_columns):
            raise_import_error(
                ImportErrorCode.MISSING_FIELD,
                message="RDES amplification cycle columns must be positive integer headers.",
                column="cycle",
            )

        channel_roles: dict[str, ImportRole] = {}
        for row in rows:
            dye = row.get("dye", "").strip()
            role = row.get("role", "").strip()
            if dye and role:
                channel_roles[dye] = ImportRole(role)

        roles = set(channel_roles.values())
        config = MappingConfig(
            assay_mode=_infer_assay_mode(roles),
            normalization_mode=NormalizationMode.PASSIVE_REFERENCE
            if ImportRole.NORMALIZATION in roles
            else NormalizationMode.NONE,
            channel_roles=channel_roles or {"unknown": ImportRole.UNKNOWN},
        )
        _raise_for_mapping_issues(validate_mapping_config(config).issues)

        readings: list[ImportReading] = []
        samples: dict[str, str] = {}
        targets: dict[str, str] = {}
        issues: list[ValidationIssue] = []
        seen: set[tuple[str, int, str]] = set()
        channel_order: list[str] = []
        dye_names: dict[str, str] = {}

        for row_number, row in enumerate(rows, start=2):
            well = _parse_well(row.get("well", ""), row_number, "well")
            channel_id = row.get("dye", "").strip()
            if channel_id not in channel_roles:
                continue
            if channel_id not in channel_order:
                channel_order.append(channel_id)
            dye_names[channel_id] = channel_id
            if row.get("sample"):
                samples.setdefault(well, row["sample"])
            if row.get("target"):
                targets.setdefault(well, row["target"])
            for cycle_column in cycle_columns:
                raw_value = row.get(cycle_column, "")
                if raw_value == "":
                    issues.append(make_issue(ImportErrorCode.INVALID_NUMERIC_VALUE, row=row_number, column=cycle_column))
                    continue
                cycle = int(cycle_column)
                rfu = _parse_rfu(raw_value, row_number, cycle_column, ".")
                key = (well, cycle, channel_id)
                if key in seen:
                    issues.append(make_issue(ImportErrorCode.DUPLICATE_READING, row=row_number, column=cycle_column))
                    continue
                seen.add(key)
                readings.append(ImportReading(well=well, cycle=cycle, channel_id=channel_id, rfu=rfu))

        _raise_if_issues(issues)
        run = _build_import_run(
            "Q-Prism RDES Extension",
            config,
            channel_order,
            dye_names,
            readings,
            samples,
            targets,
        )
        run.metadata["format"] = "qprism_rdes_extension"
        return run

    def to_unified(self, import_run: ImportRun) -> UnifiedData:
        return _to_duplex_unified(import_run)


def _read_rdes(file_path: Path) -> tuple[list[str], list[dict[str, str]]]:
    text = file_path.read_text(encoding="utf-8-sig")
    matrix = list(csv.reader(text.splitlines(), delimiter="\t"))
    if not matrix:
        raise_import_error(ImportErrorCode.UNSUPPORTED_CONTENT)
    headers = [header.strip().lower() for header in matrix[0]]
    if len(matrix) - 1 > MAX_IMPORT_ROWS:
        raise_import_error(ImportErrorCode.FILE_LIMIT_EXCEEDED)
    if not _STRICT_RDES_HEADERS.issubset(set(headers)):
        raise_import_error(ImportErrorCode.MISSING_FIELD)

    rows: list[dict[str, str]] = []
    issues: list[ValidationIssue] = []
    for row_number, row in enumerate(matrix[1:], start=2):
        if len(row) != len(headers):
            issues.append(
                make_issue(
                    ImportErrorCode.INCONSISTENT_CYCLE_COUNT,
                    row=row_number,
                    context={"expected_columns": len(headers), "actual_columns": len(row)},
                )
            )
            continue
        rows.append({header: value.strip() for header, value in zip(headers, row)})
    if issues:
        raise ImportValidationError(issues)
    return headers, rows
