"""Instrument identity declared by the source file, for every supported format.

Only what the file states is reported; a missing field stays ``None`` and
nothing is inferred from the file format. ``.eds`` archives declare the model in
``experiment.xml`` / ``messages.log`` and the software in ``Manifest.mf``; CFX
``.pcrd`` files carry both in the XML; ``.xls`` and CFX exports carry them in a
header row or the Run Information sheet; RDML in its instrument elements.
"""

import re
import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Iterable, Sequence
from typing import BinaryIO

from app.models import InstrumentDetail
from app.parsers.eds_common import _find_file

VENDOR = "Applied Biosystems"
BIORAD = "Bio-Rad"
MAX_FIELD_LENGTH = 80
MESSAGES_LOG_LIMIT = 16 * 1024 * 1024

_KNOWN_MODELS = {"steponeplus": "StepOnePlus", "stepone": "StepOne"}
_QUANTSTUDIO_ID = re.compile(r"quantstudio\s*(\d+\w*)", re.IGNORECASE)
_AB_ID = re.compile(r"stepone|quantstudio|viia|7500|7900", re.IGNORECASE)
_PRODUCT = re.compile(r"-product=(\S+)", re.IGNORECASE)
_VERSION = re.compile(r"\d+(?:\.\d+)+")
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


def _clean(text: str | None) -> str | None:
    cleaned = _CONTROL_CHARS.sub("", text or "").strip()[:MAX_FIELD_LENGTH]
    return cleaned or None


def _model(type_id: str | None) -> str | None:
    if not type_id:
        return None
    known = _KNOWN_MODELS.get(type_id.lower())
    if known:
        return known
    quant = _QUANTSTUDIO_ID.fullmatch(type_id)
    return f"QuantStudio {quant.group(1).replace('_', '/')}" if quant else type_id


def _type_id(exp_xml: bytes | None) -> str | None:
    if not exp_xml:
        return None
    try:
        return _clean(ET.fromstring(exp_xml).findtext("InstrumentTypeId"))
    except ET.ParseError:
        return None


def _manifest_fields(manifest: bytes | None) -> dict[str, str]:
    """Lower-cased attributes of a Java manifest (continuation lines start with a space)."""
    if not manifest:
        return {}
    lines: list[str] = []
    for raw in manifest.decode("utf-8", errors="replace").splitlines():
        if raw.startswith(" ") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    fields: dict[str, str] = {}
    for line in lines:
        key, _, value = line.partition(":")
        fields.setdefault(key.strip().lower(), value)
    return fields


def _software(manifest: bytes | None, model: str | None) -> str | None:
    """Version, prefixed by the product title for QuantStudio (a StepOne version names itself)."""
    fields = _manifest_fields(manifest)
    version = _clean(fields.get("implementation-version"))
    title = _clean(fields.get("implementation-title"))
    quantstudio = bool(model) and model.lower().startswith("quantstudio")
    if version and title and quantstudio and not version.lower().startswith(title.lower()):
        return _clean(f"{title} {version}")
    return version


def messages_log_model(stream: BinaryIO, limit: int = MESSAGES_LOG_LIMIT) -> str | None:
    """Model from the first ``Instrument Properties ... -product=X`` line; reads at most ``limit`` bytes."""
    read = 0
    for raw in stream:
        read += len(raw)
        if read > limit:
            return None
        line = raw.decode("utf-8", errors="replace")
        if "Instrument Properties" not in line:
            continue
        match = _PRODUCT.search(line)
        if match:
            return _model(_clean(match.group(1)))
    return None


def eds_instrument_detail(
    exp_xml: bytes | None, manifest: bytes | None, log_model: str | None = None
) -> InstrumentDetail | None:
    """Detail from ``experiment.xml`` / ``Manifest.mf`` bytes and the ``messages.log`` model; None if none declares any."""
    type_id = _type_id(exp_xml)
    model = log_model or _model(type_id)
    software = _software(manifest, model)
    if model is None and software is None:
        return None
    named = log_model or type_id
    vendor = VENDOR if named and _AB_ID.search(named) else None
    return InstrumentDetail(vendor=vendor, model=model, software=software)


def read_eds_instrument_detail(
    zf: zipfile.ZipFile, names: list[str]
) -> InstrumentDetail | None:
    """Detail of an opened ``.eds`` archive."""
    exp_path = _find_file(names, "experiment.xml")
    manifest_path = _find_file(names, "Manifest.mf")
    log_path = _find_file(names, "messages.log")
    log_model = None
    if log_path:
        with zf.open(log_path) as stream:
            log_model = messages_log_model(stream)
    return eds_instrument_detail(
        zf.read(exp_path) if exp_path else None,
        zf.read(manifest_path) if manifest_path else None,
        log_model,
    )


# --- Applied Biosystems .xls result exports ----------------------------

def _labelled_value(rows: Iterable[Sequence[object]], label: str) -> str | None:
    """First non-empty cell right of a cell reading ``label`` (case and trailing colon ignored)."""
    for row in rows:
        cells = [str(c).strip() if c is not None else "" for c in row]
        for i, cell in enumerate(cells):
            if cell.rstrip(":").strip().lower() == label:
                value = next((c for c in cells[i + 1:] if c), None)
                if value:
                    return value
    return None


def xls_instrument_detail(rows: Iterable[Sequence[object]]) -> InstrumentDetail | None:
    """Detail from the ``Instrument Type`` row in the header block of an ``.xls`` export."""
    model = _model(_clean(_labelled_value(rows, "instrument type")))
    if model is None:
        return None
    return InstrumentDetail(vendor=VENDOR, model=model, software=None)


# --- Bio-Rad CFX -------------------------------------------------------

def normalize_cfx_model(value: str | None) -> str | None:
    """``Opus 96`` -> ``CFX Opus 96``; names already starting with ``CFX`` are kept."""
    cleaned = _clean(value)
    if not cleaned:
        return None
    return cleaned if cleaned.upper().startswith("CFX ") else f"CFX {cleaned}"


def cfx_software(version: str | None) -> str | None:
    """``CFX Maestro <version>`` from a version string (OS notes in parentheses are dropped)."""
    cleaned = _clean((version or "").split("(")[0])
    if not cleaned:
        return None
    match = _VERSION.search(cleaned)
    if match:
        return f"CFX Maestro {match.group(0)}"
    return cleaned if cleaned.lower().startswith("cfx maestro") else f"CFX Maestro {cleaned}"


def cfx_detail(model: str | None, version: str | None) -> InstrumentDetail | None:
    """Bio-Rad detail; None when the file states neither a model nor a software version."""
    model = normalize_cfx_model(model)
    software = cfx_software(version)
    if model is None and software is None:
        return None
    return InstrumentDetail(vendor=BIORAD, model=model, software=software)


def cfx_instrument_label(detail: InstrumentDetail | None, suffix: str = "") -> str:
    """Display string for ``UnifiedData.instrument``; no model is guessed when the file has none."""
    name = detail.model if detail and detail.model else "Bio-Rad CFX"
    return f"{name}{suffix}"


def pcrd_instrument_detail(root: ET.Element) -> InstrumentDetail | None:
    """Detail from ``machineProperties`` and ``header`` of a ``.pcrd`` ``experimentalData2`` root."""
    model = None
    properties = root.find(".//machineProperties")
    entry = properties.get("machinePropertiesEntry", "") if properties is not None else ""
    for pair in entry.split("|"):
        key, _, value = pair.partition(":")
        if key.strip().lower() == "block description" and value.strip():
            model = value
            break
    header = root.find(".//header")
    version = header.get("createdByClientAppVersion") if header is not None else None
    return cfx_detail(model, version)


def cfx_export_detail(rows: Iterable[Sequence[object]]) -> InstrumentDetail | None:
    """Detail from the ``CFX Maestro Version`` row of a Run Information sheet."""
    return cfx_detail(None, _labelled_value(rows, "cfx maestro version"))


def cfx_xml_export_detail(root: ET.Element) -> InstrumentDetail | None:
    """Detail from a Run Information XML export (version as a tag, or as a label/value pair)."""
    rows: list[list[str]] = []
    for parent in root.iter():
        decoded = parent.tag.replace("_x0020_", " ")
        if decoded.lower() == "cfx maestro version":
            rows.append([decoded, (parent.text or "").strip()])
        children = list(parent)
        rows.append([(c.text or "").strip() for c in children])
    return cfx_export_detail(rows)


# --- RDML --------------------------------------------------------------

def rdml_instrument_detail(
    model: str | None, vendor: str | None, software: str | None
) -> InstrumentDetail | None:
    """Detail from RDML instrument / manufacturer / software texts; None if all are absent."""
    detail = InstrumentDetail(vendor=_clean(vendor), model=_clean(model), software=_clean(software))
    if detail.vendor is None and detail.model is None and detail.software is None:
        return None
    return detail
