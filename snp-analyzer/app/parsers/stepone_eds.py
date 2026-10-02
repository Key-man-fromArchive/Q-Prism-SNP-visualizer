"""Parser for StepOnePlus ``.eds`` raw files (``multicomponent_data.txt``).

A StepOne ``.eds`` is a ZIP like the QuantStudio one but carries its dye data
as tab separated text instead of ``multicomponentdata.xml``:

  * one record per (well, read, dye): ``WELL CYCLE DYE MSE SIGNAL PUREDYE0``
    followed by exactly three continuation lines (start with a tab);
  * a per-(well, read) summary ``WELL CYCLE MSE`` that is glued onto the next
    record line (9 fields); the last summary has 3 (or 4, trailing tab) fields.

The signal is field 4 (``f[4]``); field 3 is the MSE. Reading one column to the
left silently yields plausible but wrong numbers, so a test pins this.
"""

import math
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass

from pydantic import ValidationError

from app.models import AlleleLabels, DataWindow, ReadLabel, UnifiedData, WellCycleData
from app.parsers.eds_common import (
    _find_file,
    _parse_plate_metadata,
    _parse_protocol,
    _well_sort_key,
    well_index_to_id,
)
from app.parsers.instrument_detail import read_eds_instrument_detail

DYES = ("FAM", "ROX", "VIC")
PLATE_ROWS, PLATE_COLS = 8, 12
MAX_WELLS = PLATE_ROWS * PLATE_COLS
MAX_LINES = 500_000
MAX_TEXT_BYTES = 64 * 1024 * 1024
MAX_READS = 1000
CONTINUATION_LINES = 3
RECORD_FIELDS = 6
SUMMARY_FIELDS = 3

# StepOne Allele1 is normally VIC, Allele2 FAM; names map by reporter dye.
_FAM_REPORTERS = {"FAM"}
_ALLELE2_REPORTERS = {"VIC", "HEX", "JOE", "TET"}
_DEFAULT_ALLELE_NAMES = ("Allele 1", "Allele 2")


@dataclass(frozen=True)
class _Read:
    stage: str
    pcr_cycle: int | None
    temperature: float | None


# --- multicomponent_data.txt ---------------------------------------------


def _fail(line_no: int, message: str) -> ValueError:
    return ValueError(f"multicomponent_data.txt line {line_no}: {message}")


def _add_record(
    fields: list[str], line_no: int, records: dict[tuple[int, int], dict[str, float]]
) -> None:
    try:
        well, cycle = int(fields[0]), int(fields[1])
        signal = float(fields[4])
    except ValueError:
        raise _fail(line_no, "malformed record") from None
    dye = fields[2].strip().upper()
    if dye not in DYES:
        raise _fail(line_no, "unexpected dye")
    if not math.isfinite(signal):
        raise _fail(line_no, "non-finite signal")
    if well < 0 or cycle < 0:
        raise _fail(line_no, "negative well or cycle index")
    slot = records.setdefault((well, cycle), {})
    if dye in slot:
        raise _fail(line_no, "duplicate record")
    slot[dye] = signal


def _check_summary(fields: list[str], line_no: int) -> None:
    try:
        int(fields[0])
        int(fields[1])
        float(fields[2])
    except ValueError:
        raise _fail(line_no, "malformed summary") from None


def _consume_line(
    fields: list[str], line_no: int, records: dict[tuple[int, int], dict[str, float]]
) -> int:
    """Handle one non-continuation line; return how many continuation lines follow."""
    if len(fields) < SUMMARY_FIELDS:
        raise _fail(line_no, "too few fields")
    if fields[2].strip().upper() in DYES:
        if len(fields) != RECORD_FIELDS:
            raise _fail(line_no, "unexpected field count")
        record = fields
    else:
        _check_summary(fields, line_no)
        rest = fields[SUMMARY_FIELDS:]
        if len(rest) < RECORD_FIELDS:
            if any(part.strip() for part in rest):
                raise _fail(line_no, "unexpected trailing fields")
            return 0
        if len(rest) != RECORD_FIELDS:
            raise _fail(line_no, "unexpected field count")
        record = rest
    _add_record(record, line_no, records)
    return CONTINUATION_LINES


def parse_multicomponent_text(text: str) -> dict[tuple[int, int], dict[str, float]]:
    """Return ``{(well_index, read_index): {dye: signal}}`` from the raw text."""
    lines = text.split("\n")
    if len(lines) > MAX_LINES:
        raise ValueError(f"multicomponent_data.txt has too many lines (> {MAX_LINES})")
    records: dict[tuple[int, int], dict[str, float]] = {}
    pending = 0
    started = False
    for line_no, raw in enumerate(lines, start=1):
        line = raw.rstrip("\r")
        if not line.strip():
            continue
        if line.startswith("\t"):
            if pending == 0:
                raise _fail(line_no, "unexpected continuation line")
            pending -= 1
            continue
        fields = line.split("\t")
        if not started:
            if not fields[0].strip().isdigit():
                continue  # title / column header
            started = True
        if pending:
            raise _fail(line_no, "record is missing continuation lines")
        pending = _consume_line(fields, line_no, records)
    if pending:
        raise _fail(len(lines), "file ends inside a record")
    return records


def _validate_records(
    records: dict[tuple[int, int], dict[str, float]],
) -> tuple[list[int], list[int]]:
    if not records:
        raise ValueError("multicomponent_data.txt contains no data records")
    wells = sorted({w for w, _ in records})
    reads = sorted({c for _, c in records})
    if wells[-1] >= MAX_WELLS:
        raise ValueError(
            f"Only 96-well StepOnePlus plates are supported (well index {wells[-1]})"
        )
    if reads != list(range(reads[0], reads[0] + len(reads))):
        raise ValueError("multicomponent_data.txt read indices are not contiguous")
    for well in wells:
        for read in reads:
            if set(records.get((well, read), {})) != set(DYES):
                raise ValueError(
                    f"multicomponent_data.txt is incomplete for well index {well}, read {read}"
                )
    return wells, reads


# --- tcprotocol.xml: read plan -------------------------------------------


def _step_temperature(step: ET.Element) -> float | None:
    text = step.findtext("Temperature")
    try:
        return float(text) if text is not None else None
    except ValueError:
        return None


def _stage_repetitions(stage: ET.Element) -> int:
    try:
        reps = int(stage.findtext("NumOfRepetitions", "1"))
    except ValueError:
        raise ValueError("tcprotocol.xml has a non-numeric repetition count") from None
    if not 1 <= reps <= MAX_READS:
        raise ValueError("tcprotocol.xml repetition count is out of range")
    return reps


def _single_read(label: str, collecting: list[ET.Element]) -> list[_Read]:
    return [_Read(label, None, _step_temperature(collecting[0]))] if collecting else []


def plan_reads(tc_xml: bytes) -> list[_Read]:
    """Reads in acquisition order: Pre-read, one per collecting cycling step, Post-read."""
    plan: list[_Read] = []
    pcr_done = 0
    for stage in ET.fromstring(tc_xml).findall("TCStage"):
        flag = stage.findtext("StageFlag", "")
        collecting = [
            s
            for s in stage.findall("TCStep")
            if s.findtext("CollectionFlag", "0") == "1"
        ]
        if flag == "PRE_READ":
            plan += _single_read("Pre-read", collecting)
        elif flag == "POST_READ":
            plan += _single_read("Post-read", collecting)
        elif flag == "CYCLING":
            reps = _stage_repetitions(stage)
            plan += [
                _Read("Amplification", pcr_done + rep, _step_temperature(step))
                for rep in range(1, reps + 1)
                for step in collecting
            ]
            pcr_done += reps
        elif collecting:
            raise ValueError(
                f"Data collection in a {flag or 'unnamed'} stage is not supported"
            )
        if len(plan) > MAX_READS:
            raise ValueError("tcprotocol.xml declares too many reads")
    return plan


def _windows(plan: list[_Read]) -> list[DataWindow]:
    windows: list[DataWindow] = []
    for cycle, read in enumerate(plan, start=1):
        if windows and windows[-1].name == read.stage:
            windows[-1].end_cycle = cycle
        else:
            windows.append(
                DataWindow(name=read.stage, start_cycle=cycle, end_cycle=cycle)
            )
    return windows


# --- experiment.xml: instrument and allele names -------------------------


def _check_instrument(exp_xml: bytes) -> None:
    root = ET.fromstring(exp_xml)
    if root.findtext("InstrumentTypeId", "").strip().lower() != "steponeplus":
        raise ValueError(
            "Unsupported StepOne instrument: only StepOnePlus (96-well) is supported"
        )


def _marker_labels(marker: ET.Element) -> AlleleLabels | None:
    by_role: dict[str, str] = {}
    names: list[str] = []
    for tag in ("Allele1", "Allele2"):
        name = marker.findtext(f"{tag}/Name", "").strip()
        reporter = marker.findtext(f"{tag}/Reporter", "").strip().upper()
        names.append(name)
        if reporter in _FAM_REPORTERS:
            by_role.setdefault("fam", name)
        elif reporter in _ALLELE2_REPORTERS:
            by_role.setdefault("allele2", name)
    if len(by_role) != 2 or tuple(names) == _DEFAULT_ALLELE_NAMES:
        return None
    try:
        return AlleleLabels(**by_role)
    except ValidationError:
        return None


def parse_marker_alleles(exp_xml: bytes, used: set[str]) -> dict[str, AlleleLabels]:
    """Allele names per marker in ``used`` (markers placed on the plate)."""
    seen: dict[str, AlleleLabels | None] = {}
    for marker in ET.fromstring(exp_xml).iter("Markers"):
        name = marker.findtext("Name", "").strip()
        if name not in used:
            continue
        parsed = _marker_labels(marker)
        # Repeated entries must agree; a conflict leaves the marker unnamed.
        seen[name] = parsed if seen.get(name, parsed) == parsed else None
    return {name: parsed for name, parsed in seen.items() if parsed is not None}


# --- assembly -------------------------------------------------------------


def _read_text(zf: zipfile.ZipFile, member: str) -> str:
    with zf.open(member) as handle:
        raw = handle.read(MAX_TEXT_BYTES + 1)
    if len(raw) > MAX_TEXT_BYTES:
        raise ValueError("multicomponent_data.txt is too large")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError("multicomponent_data.txt is not valid UTF-8 text") from None


def _build_data(
    records: dict[tuple[int, int], dict[str, float]], wells: list[int], reads: list[int]
) -> list[WellCycleData]:
    data: list[WellCycleData] = []
    for well in wells:
        well_id = well_index_to_id(well, PLATE_COLS)
        for cycle, read in enumerate(reads, start=1):
            signal = records[(well, read)]
            data.append(
                WellCycleData(
                    well=well_id,
                    cycle=cycle,
                    fam=signal["FAM"],
                    allele2=signal["VIC"],
                    rox=signal["ROX"],
                )
            )
    return data


def _plate_metadata(
    zf: zipfile.ZipFile, names: list[str], well_ids: set[str]
) -> tuple[dict[str, str], dict[str, list[str]] | None]:
    path = _find_file(names, "plate_setup.xml")
    if not path:
        return {}, None
    sample_raw, groups_raw, _ = _parse_plate_metadata(zf.read(path))
    samples = {
        well_index_to_id(i, PLATE_COLS): n
        for i, n in sample_raw.items()
        if 0 <= i < MAX_WELLS and well_index_to_id(i, PLATE_COLS) in well_ids
    }
    markers: dict[str, list[str]] = {}
    for name, indices in (groups_raw or {}).items():
        ids = {
            well_index_to_id(i, PLATE_COLS)
            for i in indices
            if 0 <= i < MAX_WELLS and well_index_to_id(i, PLATE_COLS) in well_ids
        }
        if ids:
            markers[name] = sorted(ids, key=_well_sort_key)
    return samples, markers or None


def parse_stepone_eds(zf: zipfile.ZipFile, names: list[str]) -> UnifiedData:
    """Parse an opened StepOnePlus ``.eds`` archive (``multicomponent_data.txt``)."""
    exp_path = _find_file(names, "experiment.xml")
    tc_path = _find_file(names, "tcprotocol.xml")
    mc_path = _find_file(names, "multicomponent_data.txt")
    if not exp_path or not tc_path or not mc_path:
        raise ValueError(
            "This StepOne .eds file is missing experiment.xml, tcprotocol.xml "
            "or multicomponent_data.txt."
        )
    exp_xml = zf.read(exp_path)
    _check_instrument(exp_xml)
    tc_xml = zf.read(tc_path)
    plan = plan_reads(tc_xml)

    records = parse_multicomponent_text(_read_text(zf, mc_path))
    wells, reads = _validate_records(records)
    if len(plan) != len(reads):
        raise ValueError(
            f"Protocol declares {len(plan)} reads but the data holds {len(reads)}"
        )

    well_ids = {well_index_to_id(w, PLATE_COLS) for w in wells}
    samples, markers = _plate_metadata(zf, names, well_ids)
    alleles = parse_marker_alleles(exp_xml, set(markers or {}))
    windows = _windows(plan)
    amp = next((w for w in windows if w.name == "Amplification"), None)

    return UnifiedData(
        instrument="StepOnePlus (raw)",
        allele2_dye="VIC",
        wells=sorted(well_ids, key=_well_sort_key),
        cycles=list(range(1, len(reads) + 1)),
        data=_build_data(records, wells, reads),
        has_rox=True,
        sample_names=samples or None,
        imported_markers=markers,
        protocol_steps=_parse_protocol(tc_xml) or None,
        data_windows=windows,
        ntc_wells=None,
        default_cycle=amp.start_cycle if amp else None,
        has_amplification_curve=False,
        read_labels={
            cycle: ReadLabel(
                stage=read.stage, pcr_cycle=read.pcr_cycle, temperature=read.temperature
            )
            for cycle, read in enumerate(plan, start=1)
        },
        imported_marker_alleles=alleles or None,
        instrument_detail=read_eds_instrument_detail(zf, names),
    )
