"""Instrument identity declared inside an Applied Biosystems ``.eds`` archive.

Only what the file states is reported: the model comes from
``experiment.xml`` ``InstrumentTypeId`` and the software from ``Manifest.mf``
``Implementation-Version``. A missing field stays ``None``; nothing is inferred
from the file format.
"""

import re
import xml.etree.ElementTree as ET
import zipfile

from app.models import InstrumentDetail
from app.parsers.eds_common import _find_file

VENDOR = "Applied Biosystems"
MAX_FIELD_LENGTH = 80

_KNOWN_MODELS = {"steponeplus": "StepOnePlus", "stepone": "StepOne"}
_QUANTSTUDIO_ID = re.compile(r"quantstudio\s*(\d+\w*)", re.IGNORECASE)
_AB_ID = re.compile(r"stepone|quantstudio|viia|7500|7900", re.IGNORECASE)
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
    return f"QuantStudio {quant.group(1)}" if quant else type_id


def _type_id(exp_xml: bytes | None) -> str | None:
    if not exp_xml:
        return None
    try:
        return _clean(ET.fromstring(exp_xml).findtext("InstrumentTypeId"))
    except ET.ParseError:
        return None


def _software(manifest: bytes | None) -> str | None:
    """``Implementation-Version`` of a Java manifest (continuation lines start with a space)."""
    if not manifest:
        return None
    lines: list[str] = []
    for raw in manifest.decode("utf-8", errors="replace").splitlines():
        if raw.startswith(" ") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    for line in lines:
        key, _, value = line.partition(":")
        if key.strip().lower() == "implementation-version":
            return _clean(value)
    return None


def eds_instrument_detail(
    exp_xml: bytes | None, manifest: bytes | None
) -> InstrumentDetail | None:
    """Detail from ``experiment.xml`` and ``Manifest.mf`` bytes; None if neither declares any."""
    type_id = _type_id(exp_xml)
    model = _model(type_id)
    software = _software(manifest)
    if model is None and software is None:
        return None
    vendor = VENDOR if type_id and _AB_ID.search(type_id) else None
    return InstrumentDetail(vendor=vendor, model=model, software=software)


def read_eds_instrument_detail(
    zf: zipfile.ZipFile, names: list[str]
) -> InstrumentDetail | None:
    """Detail of an opened ``.eds`` archive."""
    exp_path = _find_file(names, "experiment.xml")
    manifest_path = _find_file(names, "Manifest.mf")
    return eds_instrument_detail(
        zf.read(exp_path) if exp_path else None,
        zf.read(manifest_path) if manifest_path else None,
    )
