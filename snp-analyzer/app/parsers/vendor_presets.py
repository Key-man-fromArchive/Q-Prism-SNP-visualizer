from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.import_models import (
    AssayModeId,
    ImportPreview,
    ImportRole,
    MappingConfig,
    NormalizationMode,
    ReporterChannel,
)


@dataclass(frozen=True)
class VendorPreset:
    preset_id: str
    vendor: str
    label: str
    matcher: Callable[[ImportPreview], bool]
    applier: Callable[[ImportPreview], MappingConfig | None]


def apply_vendor_presets(preview: ImportPreview) -> ImportPreview:
    for preset in VENDOR_PRESETS:
        if not preset.matcher(preview):
            continue
        mapping = preset.applier(preview)
        preview.metadata["vendor_preset"] = {
            "preset_id": preset.preset_id,
            "vendor": preset.vendor,
            "label": preset.label,
            "non_authoritative": True,
        }
        if mapping is not None:
            preview.suggested_mapping = mapping
        break
    return preview


def _filename(preview: ImportPreview) -> str:
    return Path(preview.filename).name.lower()


def _headers(preview: ImportPreview) -> set[str]:
    return {header.lower() for header in preview.inferred_headers}


def _metadata_text(preview: ImportPreview) -> str:
    values: list[str] = []
    for value in preview.metadata.values():
        if isinstance(value, str):
            values.append(value)
        elif isinstance(value, dict):
            values.extend(str(item) for item in value.values())
        elif isinstance(value, list):
            values.extend(str(item) for item in value[:20])
    return " ".join(values).lower()


def _channels_by_common_dye(preview: ImportPreview) -> dict[str, str]:
    matches: dict[str, str] = {}
    for channel in preview.channel_candidates:
        key = (channel.dye_name or channel.channel_id).lower()
        if "fam" in key:
            matches.setdefault("fam", channel.channel_id)
        elif "vic" in key or "hex" in key or "joe" in key:
            matches.setdefault("vic", channel.channel_id)
        elif "rox" in key:
            matches.setdefault("rox", channel.channel_id)
    return matches


def _text_columns_by_common_dye(preview: ImportPreview) -> dict[str, str]:
    matches: dict[str, str] = {}
    for header in preview.inferred_headers:
        key = header.lower()
        if "fam" in key:
            matches.setdefault("fam", header)
        elif "vic" in key or "hex" in key or "joe" in key:
            matches.setdefault("vic", header)
        elif "rox" in key:
            matches.setdefault("rox", header)
    return matches


def _roche_match(preview: ImportPreview) -> bool:
    name = _filename(preview)
    headers = _headers(preview)
    return (
        "lightcycler" in name
        or "roche" in name
        or {"well", "cycle", "fam", "vic"}.issubset(headers)
        or {"position", "cycle", "fam", "hex"}.issubset(headers)
    )


def _roche_apply(preview: ImportPreview) -> MappingConfig | None:
    columns = _text_columns_by_common_dye(preview)
    well_column = _first_present(preview.inferred_headers, ["well", "position"])
    cycle_column = _first_present(preview.inferred_headers, ["cycle"])
    if not well_column or not cycle_column or not {"fam", "vic"}.issubset(columns):
        return None
    channel_roles = {
        columns["fam"]: ImportRole.WT,
        columns["vic"]: ImportRole.MT1,
    }
    rfu_columns = {
        columns["fam"]: columns["fam"],
        columns["vic"]: columns["vic"],
    }
    if "rox" in columns:
        channel_roles[columns["rox"]] = ImportRole.NORMALIZATION
        rfu_columns[columns["rox"]] = columns["rox"]
    return MappingConfig(
        assay_mode=AssayModeId.WT_MT,
        normalization_mode=NormalizationMode.PASSIVE_REFERENCE
        if "rox" in columns
        else NormalizationMode.NONE,
        channel_roles=channel_roles,
        vendor_preset_id="roche-lightcycler-text",
        well_column=well_column,
        cycle_column=cycle_column,
        sample_column=_first_present(preview.inferred_headers, ["sample", "sample name"]),
        target_column=_first_present(preview.inferred_headers, ["target", "target name"]),
        rfu_columns=rfu_columns,
    )


def _analytik_match(preview: ImportPreview) -> bool:
    name = _filename(preview)
    headers = _headers(preview)
    return (
        "qpcrsoft" in name
        or "analytik" in name
        or {"well", "cycle", "channel", "fluorescence"}.issubset(headers)
        or {"well", "cycle", "dye", "fluorescence"}.issubset(headers)
    )


def _analytik_apply(preview: ImportPreview) -> MappingConfig | None:
    well_column = _first_present(preview.inferred_headers, ["well", "position"])
    cycle_column = _first_present(preview.inferred_headers, ["cycle"])
    dye_column = _first_present(preview.inferred_headers, ["dye", "channel", "reporter"])
    rfu_column = _first_present(preview.inferred_headers, ["fluorescence", "rfu", "signal"])
    if not well_column or not cycle_column or not dye_column or not rfu_column:
        return None
    return MappingConfig(
        assay_mode=AssayModeId.WT_MT,
        normalization_mode=NormalizationMode.NONE,
        channel_roles={"FAM": ImportRole.WT, "VIC": ImportRole.MT1},
        vendor_preset_id="analytik-jena-qpcrsoft",
        well_column=well_column,
        cycle_column=cycle_column,
        sample_column=_first_present(preview.inferred_headers, ["sample", "sample name"]),
        target_column=_first_present(preview.inferred_headers, ["target", "gene", "assay"]),
        dye_column=dye_column,
        rfu_column=rfu_column,
    )


def _qiagen_match(preview: ImportPreview) -> bool:
    text = f"{_filename(preview)} {_metadata_text(preview)}"
    return preview.parser_id == "rdml" and ("rotor-gene" in text or "rotorgene" in text or "qiagen" in text)


def _qiagen_apply(preview: ImportPreview) -> MappingConfig | None:
    channels = _channels_by_common_dye(preview)
    if not {"fam", "vic"}.issubset(channels):
        return None
    channel_roles = {
        channels["fam"]: ImportRole.WT,
        channels["vic"]: ImportRole.MT1,
    }
    if "rox" in channels:
        channel_roles[channels["rox"]] = ImportRole.NORMALIZATION
    run_id = None
    runs = preview.metadata.get("runs")
    if isinstance(runs, list) and len(runs) == 1 and isinstance(runs[0], dict):
        value = runs[0].get("run_id")
        run_id = str(value) if value is not None else None
    return MappingConfig(
        assay_mode=AssayModeId.WT_MT,
        normalization_mode=NormalizationMode.PASSIVE_REFERENCE
        if "rox" in channels
        else NormalizationMode.NONE,
        channel_roles=channel_roles,
        vendor_preset_id="qiagen-rotor-gene-rdml",
        rdml_run_id=run_id,
    )


def _first_present(headers: list[str], candidates: list[str]) -> str | None:
    normalized: dict[str, str] = {header.lower(): header for header in headers}
    for candidate in candidates:
        if candidate in normalized:
            return normalized[candidate]
    for header in headers:
        header_key = header.lower()
        if any(candidate in header_key for candidate in candidates):
            return header
    return None


VENDOR_PRESETS: tuple[VendorPreset, ...] = (
    VendorPreset(
        preset_id="roche-lightcycler-text",
        vendor="Roche",
        label="LightCycler text export",
        matcher=_roche_match,
        applier=_roche_apply,
    ),
    VendorPreset(
        preset_id="analytik-jena-qpcrsoft",
        vendor="Analytik Jena",
        label="qPCRsoft CSV/XLSX export",
        matcher=_analytik_match,
        applier=_analytik_apply,
    ),
    VendorPreset(
        preset_id="qiagen-rotor-gene-rdml",
        vendor="Qiagen",
        label="Rotor-Gene RDML export",
        matcher=_qiagen_match,
        applier=_qiagen_apply,
    ),
)
