from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

from app.assays.registry import validate_mapping_config
from app.import_errors import ImportErrorCode, ImportValidationError, make_issue, raise_import_error
from app.import_models import (
    AssayModeId,
    ImportPreview,
    ImportReading,
    ImportRole,
    ImportRun,
    MappingConfig,
    ReporterChannel,
    ValidationIssue,
)
from app.models import UnifiedData
from app.parsers.detector import _validate_zip_archive
from app.parsers.generic_table import (
    MAX_IMPORT_ROWS,
    _build_import_run,
    _parse_rfu,
    _parse_well,
    _raise_for_mapping_issues,
    _raise_if_issues,
    _to_duplex_unified,
)
from app.parsers.vendor_presets import apply_vendor_presets


MAX_RDML_XML_BYTES = 25 * 1024 * 1024
_WELL_RE = re.compile(r"^[A-Ha-h](?:[1-9]|1[0-2])$")
_UNSAFE_XML_TOKENS = (b"<!doctype", b"<!entity")


@dataclass(frozen=True)
class _TargetDef:
    target_id: str
    dye_name: str | None = None


@dataclass(frozen=True)
class _RdmlPoint:
    cycle: int
    rfu: float


@dataclass(frozen=True)
class _RdmlSeries:
    run_id: str
    well: str
    target_id: str
    channel_id: str
    dye_name: str | None
    points: tuple[_RdmlPoint, ...]
    sample: str | None = None


@dataclass
class _RdmlDocument:
    source_entry: str | None
    targets: dict[str, _TargetDef] = field(default_factory=dict)
    series: list[_RdmlSeries] = field(default_factory=list)
    instrument: str | None = None
    vendor: str | None = None

    @property
    def run_ids(self) -> list[str]:
        return sorted({series.run_id for series in self.series})

    @property
    def channel_ids(self) -> list[str]:
        return sorted({series.channel_id for series in self.series})


class RDMLParser:
    parser_id = "rdml"

    def sniff(self, file_path: Path, original_filename: str) -> bool:
        suffix = Path(original_filename or file_path.name).suffix.lower()
        if suffix not in {".rdml", ".rdm"}:
            return False
        try:
            document = _read_rdml(file_path)
        except ImportValidationError:
            return False
        return bool(document.run_ids)

    def preview(self, file_path: Path, original_filename: str) -> ImportPreview:
        document = _read_rdml(file_path)
        warnings = [
            make_issue(
                ImportErrorCode.MAPPING_CONFIG_REQUIRED,
                message="RDML files require explicit run, target, and channel-to-role confirmation.",
            )
        ]
        preview = ImportPreview(
            preview_id="",
            parser_id=self.parser_id,
            filename=original_filename,
            candidate_tables=document.run_ids,
            channel_candidates=_channel_candidates(document),
            assay_mode_candidates=[
                AssayModeId.WT_MT,
                AssayModeId.WT_MT1_MT2,
                AssayModeId.WT_MT1_MT2_MT3,
            ],
            warnings=warnings,
            sample_rows=_sample_rows(document),
            metadata={
                "format": "rdml",
                "source_entry": document.source_entry,
                "instrument": document.instrument,
                "vendor": document.vendor,
                "runs": _run_metadata(document),
                "targets": [
                    {"target_id": target.target_id, "dye_name": target.dye_name}
                    for target in sorted(document.targets.values(), key=lambda item: item.target_id)
                ],
                "candidate_channel_mappings": _candidate_channel_mappings(document),
                "preview_first": True,
            },
        )
        return apply_vendor_presets(preview)

    def parse(
        self,
        file_path: Path,
        original_filename: str,
        mapping_config: MappingConfig | None = None,
    ) -> ImportRun:
        if mapping_config is None:
            raise_import_error(ImportErrorCode.MAPPING_CONFIG_REQUIRED)

        _raise_for_mapping_issues(validate_mapping_config(mapping_config).issues)
        document = _read_rdml(file_path)
        selected_run = _select_run(document, mapping_config)
        selected_targets = set(mapping_config.rdml_target_ids)
        if not selected_targets:
            selected_targets = {
                series.target_id
                for series in document.series
                if series.run_id == selected_run
                and mapping_config.channel_roles.get(series.channel_id) not in {
                    None,
                    ImportRole.EXCLUDED,
                    ImportRole.UNKNOWN,
                }
            }

        series = [
            item
            for item in document.series
            if item.run_id == selected_run
            and item.target_id in selected_targets
            and mapping_config.channel_roles.get(item.channel_id) not in {
                None,
                ImportRole.EXCLUDED,
                ImportRole.UNKNOWN,
            }
        ]
        if not series:
            raise_import_error(
                ImportErrorCode.MISSING_FIELD,
                message="No RDML raw amplification curves matched the selected run, targets, and channels.",
                context={"run_id": selected_run, "target_ids": sorted(selected_targets)},
            )

        readings: list[ImportReading] = []
        samples: dict[str, str] = {}
        targets: dict[str, str] = {}
        channel_order: list[str] = []
        dye_names: dict[str, str] = {}
        populated_channels: set[str] = set()
        seen: set[tuple[str, int, str]] = set()
        issues: list[ValidationIssue] = []

        for item in series:
            row_number = 0
            well = _parse_well(item.well, row_number, "rdml.react")
            if item.channel_id not in channel_order:
                channel_order.append(item.channel_id)
            if item.dye_name:
                dye_names[item.channel_id] = item.dye_name
            if item.sample:
                samples.setdefault(well, item.sample)
            targets.setdefault(well, item.target_id)
            if not item.points:
                issues.append(
                    make_issue(
                        ImportErrorCode.MISSING_FIELD,
                        message="RDML selected target has no raw amplification data points.",
                        channel_id=item.channel_id,
                        context={"run_id": item.run_id, "target_id": item.target_id, "well": well},
                    )
                )
                continue
            for point in item.points:
                key = (well, point.cycle, item.channel_id)
                if key in seen:
                    issues.append(
                        make_issue(
                            ImportErrorCode.DUPLICATE_READING,
                            channel_id=item.channel_id,
                            context={"well": well, "cycle": point.cycle, "channel_id": item.channel_id},
                        )
                    )
                    continue
                seen.add(key)
                populated_channels.add(item.channel_id)
                readings.append(
                    ImportReading(
                        well=well,
                        cycle=point.cycle,
                        channel_id=item.channel_id,
                        rfu=point.rfu,
                    )
                )

        issues.extend(_missing_selected_channel_issues(mapping_config, populated_channels, document.channel_ids))
        _raise_if_issues(issues)
        if len(readings) > MAX_IMPORT_ROWS:
            raise_import_error(ImportErrorCode.FILE_LIMIT_EXCEEDED)

        run = _build_import_run(
            document.instrument or "RDML qPCR",
            mapping_config,
            channel_order,
            dye_names,
            readings,
            samples,
            targets,
        )
        run.metadata.update(
            {
                "format": "rdml",
                "rdml_run_id": selected_run,
                "rdml_target_ids": sorted(selected_targets),
                "vendor_preset_id": mapping_config.vendor_preset_id,
            }
        )
        return run

    def to_unified(self, import_run: ImportRun) -> UnifiedData:
        return _to_duplex_unified(import_run)


def _read_rdml(file_path: Path) -> _RdmlDocument:
    xml_bytes, source_entry = _read_rdml_bytes(file_path)
    root = _safe_parse_xml(xml_bytes)
    if _local_name(root.tag) != "rdml":
        raise_import_error(ImportErrorCode.UNSUPPORTED_CONTENT, message="The XML root is not RDML.")

    document = _RdmlDocument(source_entry=source_entry)
    document.instrument = _first_text(root, {"instrument", "device", "thermalCycler"})
    vendor_text = _first_text(root, {"vendor", "manufacturer", "software"})
    document.vendor = vendor_text
    if document.instrument is None:
        document.instrument = vendor_text

    document.targets.update(_target_defs(root))
    for run_index, run_element in enumerate(_iter_local(root, "run"), start=1):
        run_id = _element_id(run_element) or f"run-{run_index}"
        for reaction in _iter_local(run_element, "react"):
            well = _reaction_well(reaction)
            if well is None:
                continue
            sample = _child_ref_or_text(reaction, {"sample", "sampleId", "sampleID"})
            for data_element in _iter_local(reaction, "data"):
                target_id = _data_target_id(data_element)
                if target_id is None:
                    continue
                target = document.targets.get(target_id, _TargetDef(target_id=target_id))
                dye_name = _data_dye_name(data_element) or target.dye_name
                channel_id = dye_name or target_id
                points = tuple(_data_points(data_element))
                document.series.append(
                    _RdmlSeries(
                        run_id=run_id,
                        well=well,
                        target_id=target_id,
                        channel_id=channel_id,
                        dye_name=dye_name,
                        points=points,
                        sample=sample,
                    )
                )
    if not document.series:
        raise_import_error(
            ImportErrorCode.UNSUPPORTED_CONTENT,
            message="RDML file does not contain run/reaction amplification data.",
        )
    return document


def _read_rdml_bytes(file_path: Path) -> tuple[bytes, str | None]:
    if zipfile.is_zipfile(file_path):
        try:
            with zipfile.ZipFile(file_path, "r") as zf:
                _validate_zip_archive(zf)
                candidates = [
                    info
                    for info in zf.infolist()
                    if not info.is_dir()
                    and Path(info.filename).suffix.lower() in {".rdml", ".rdm", ".xml"}
                ]
                if not candidates:
                    raise_import_error(
                        ImportErrorCode.UNSUPPORTED_CONTENT,
                        message="RDML archive does not contain an XML/RDML entry.",
                    )
                entry = sorted(candidates, key=lambda item: item.filename)[0]
                data = zf.read(entry)
                return _limit_xml_bytes(data), entry.filename
        except ValueError as exc:
            raise_import_error(ImportErrorCode.FILE_LIMIT_EXCEEDED, message=str(exc))
    return _limit_xml_bytes(file_path.read_bytes()), None


def _limit_xml_bytes(data: bytes) -> bytes:
    if len(data) > MAX_RDML_XML_BYTES:
        raise_import_error(ImportErrorCode.FILE_LIMIT_EXCEEDED)
    return data


def _safe_parse_xml(data: bytes) -> ET.Element:
    lowered = data.lower()
    if any(token in lowered for token in _UNSAFE_XML_TOKENS):
        raise_import_error(
            ImportErrorCode.UNSUPPORTED_CONTENT,
            message="RDML XML with DTD or entity declarations is not accepted.",
        )
    try:
        return ET.fromstring(data)
    except ET.ParseError as exc:
        raise_import_error(ImportErrorCode.UNSUPPORTED_CONTENT, message=f"Malformed RDML XML: {exc}")


def _target_defs(root: ET.Element) -> dict[str, _TargetDef]:
    targets: dict[str, _TargetDef] = {}
    for element in _iter_local(root, "target"):
        target_id = _element_id(element)
        if not target_id:
            continue
        dye_name = (
            _first_text(element, {"dyeId", "dyeID", "dye", "channel"})
            or _child_ref_or_text(element, {"dye", "dyeId", "dyeID"})
        )
        targets[target_id] = _TargetDef(target_id=target_id, dye_name=dye_name)
    return targets


def _data_points(data_element: ET.Element) -> list[_RdmlPoint]:
    points: list[_RdmlPoint] = []
    for point in _iter_local(data_element, "adp"):
        cycle_text = _attr(point, {"cyc", "cycle"})
        fluor_text = _attr(point, {"fluor", "rfu", "value"}) or _first_text(point, {"fluor", "rfu", "value"})
        if fluor_text is None:
            fluor_text = (point.text or "").strip() or None
        if cycle_text is None or fluor_text is None:
            continue
        try:
            cycle = int(cycle_text)
        except ValueError:
            continue
        rfu = _parse_rfu(fluor_text, 0, "rdml.adp", ".")
        points.append(_RdmlPoint(cycle=cycle, rfu=rfu))
    return points


def _select_run(document: _RdmlDocument, config: MappingConfig) -> str:
    if config.rdml_run_id:
        if config.rdml_run_id not in document.run_ids:
            raise_import_error(
                ImportErrorCode.MISSING_FIELD,
                message="Selected RDML run id is not present in the file.",
                context={"run_id": config.rdml_run_id, "available_runs": document.run_ids},
            )
        return config.rdml_run_id
    if len(document.run_ids) == 1:
        return document.run_ids[0]
    raise_import_error(
        ImportErrorCode.MAPPING_CONFIG_REQUIRED,
        message="Select one RDML run before importing a multi-run file.",
        context={"available_runs": document.run_ids},
    )


def _missing_selected_channel_issues(
    config: MappingConfig,
    populated_channels: set[str],
    available_channels: list[str],
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for channel_id, role in config.channel_roles.items():
        if role in {ImportRole.EXCLUDED, ImportRole.UNKNOWN}:
            continue
        if channel_id not in available_channels:
            issues.append(
                make_issue(
                    ImportErrorCode.UNSUPPORTED_CONTENT,
                    message="Selected RDML channel is not present in this file.",
                    channel_id=channel_id,
                    context={"available_channels": available_channels},
                )
            )
        elif channel_id not in populated_channels:
            issues.append(
                make_issue(
                    ImportErrorCode.MISSING_REQUIRED_ROLE,
                    message="Selected RDML channel has no raw curve data for the chosen run/targets.",
                    channel_id=channel_id,
                )
            )
    return issues


def _sample_rows(document: _RdmlDocument) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for series in document.series[:8]:
        first = series.points[0] if series.points else None
        rows.append(
            {
                "run_id": series.run_id,
                "well": series.well,
                "sample": series.sample,
                "target_id": series.target_id,
                "channel_id": series.channel_id,
                "cycle": first.cycle if first else None,
                "rfu": first.rfu if first else None,
                "raw_points": len(series.points),
            }
        )
    return rows


def _run_metadata(document: _RdmlDocument) -> list[dict[str, object]]:
    runs: list[dict[str, object]] = []
    for run_id in document.run_ids:
        series = [item for item in document.series if item.run_id == run_id]
        runs.append(
            {
                "run_id": run_id,
                "targets": sorted({item.target_id for item in series}),
                "channels": sorted({item.channel_id for item in series}),
                "reactions": len({item.well for item in series}),
                "data_points": sum(len(item.points) for item in series),
            }
        )
    return runs


def _candidate_channel_mappings(document: _RdmlDocument) -> list[dict[str, object]]:
    mappings: list[dict[str, object]] = []
    for run_id in document.run_ids:
        by_channel: dict[str, set[str]] = {}
        for series in document.series:
            if series.run_id != run_id:
                continue
            by_channel.setdefault(series.channel_id, set()).add(series.target_id)
        mappings.append(
            {
                "run_id": run_id,
                "channels": [
                    {"channel_id": channel_id, "target_ids": sorted(target_ids)}
                    for channel_id, target_ids in sorted(by_channel.items())
                ],
            }
        )
    return mappings


def _channel_candidates(document: _RdmlDocument) -> list[ReporterChannel]:
    by_channel: dict[str, str | None] = {}
    for series in document.series:
        by_channel.setdefault(series.channel_id, series.dye_name)
    return [
        ReporterChannel(channel_id=channel_id, dye_name=dye_name)
        for channel_id, dye_name in sorted(by_channel.items())
    ]


def _data_target_id(data_element: ET.Element) -> str | None:
    return (
        _attr(data_element, {"target", "targetId", "targetID", "tar"})
        or _child_ref_or_text(data_element, {"tar", "target", "targetId", "targetID"})
    )


def _data_dye_name(data_element: ET.Element) -> str | None:
    return (
        _attr(data_element, {"dye", "dyeId", "dyeID", "channel"})
        or _child_ref_or_text(data_element, {"dye", "dyeId", "dyeID", "channel"})
    )


def _reaction_well(reaction: ET.Element) -> str | None:
    raw = (
        _attr(reaction, {"well", "position", "pos"})
        or _first_text(reaction, {"well", "position", "pos"})
        or _element_id(reaction)
    )
    if raw is None:
        return None
    raw = raw.strip()
    if _WELL_RE.match(raw):
        return raw.upper()
    if raw.isdigit():
        return _numeric_position_to_well(int(raw))
    return raw.upper()


def _numeric_position_to_well(position: int) -> str:
    if position < 1:
        return str(position)
    row_index = (position - 1) // 12
    col_index = (position - 1) % 12 + 1
    row_label = chr(ord("A") + row_index)
    return f"{row_label}{col_index}"


def _element_id(element: ET.Element) -> str | None:
    return _attr(element, {"id", "name"})


def _child_ref_or_text(element: ET.Element, names: set[str]) -> str | None:
    for child in list(element):
        if _local_name(child.tag) not in names:
            continue
        value = _attr(child, {"id", "ref", "name"}) or (child.text or "").strip()
        if value:
            return value
    return None


def _first_text(element: ET.Element, names: set[str]) -> str | None:
    for child in element.iter():
        if child is element:
            continue
        if _local_name(child.tag) in names and child.text and child.text.strip():
            return child.text.strip()
    return None


def _attr(element: ET.Element, names: set[str]) -> str | None:
    lowered = {name.lower() for name in names}
    for key, value in element.attrib.items():
        if _local_name(key).lower() in lowered and value.strip():
            return value.strip()
    return None


def _iter_local(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element.iter() if _local_name(child.tag) == name]


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]
