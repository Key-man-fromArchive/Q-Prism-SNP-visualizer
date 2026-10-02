"""Synthetic StepOnePlus ``.eds`` generator; never a biological reference.

Reproduces the *structure* of a real StepOnePlus export (ZIP layout, XML tags,
``multicomponent_data.txt`` line shapes) with invented values only. Not a test
module: it is imported by tests. Its own tests live in ``test_stepone_fixtures.py``.

``multicomponent_data.txt`` shape (CRLF, tab separated, 0-based WELL and CYCLE)::

    StepOne v2.0 MulticomponentData
    <empty line>
    WELL CYCLE DYE LIST MSE SIGNAL DATA PURE_DYE_DATA          (6 fields)
    W C DYE MSE SIGNAL PUREDYE0                               (6 fields)
    <5 tabs>PUREDYE1 / PUREDYE2 / PUREDYE3                    (6 fields, 3 lines)
    ... per dye (FAM, ROX, VIC); after the 3rd dye the per-(well, cycle)
    summary ``W C MSE`` is glued onto the next record line (9 fields); the very
    last summary has no successor (3 fields, 4 with its trailing tab).
"""

from __future__ import annotations

import io
import random
import zipfile
from dataclasses import dataclass, field
from typing import Literal

Corruption = Literal[
    "read_count_mismatch",
    "truncated",
    "duplicate_record",
    "missing_dye",
    "hold_collection",
]

DYES = ("FAM", "ROX", "VIC")
PLATE_ROWS, PLATE_COLS = 8, 12
WELLS = PLATE_ROWS * PLATE_COLS
# 1 pre-read + 5 cycling reads (40 C step of the last stage) + 1 post-read.
READS = 7
PCR_CYCLES_OF_READS: tuple[int | None, ...] = (None, 36, 37, 38, 39, 40, None)
_SUMMARY_COLS = 3
_RECORD_COLS = 6
_MERGED_COLS = _SUMMARY_COLS + _RECORD_COLS


@dataclass(frozen=True)
class AlleleSpec:
    name: str
    reporter: str


@dataclass(frozen=True)
class MarkerSpec:
    """A ``<Markers>`` entry. StepOne Allele1 is VIC, Allele2 is FAM by default."""

    name: str
    allele1: AlleleSpec = AlleleSpec("Allele 1", "VIC")
    allele2: AlleleSpec = AlleleSpec("Allele 2", "FAM")


def default_markers(preset: str = "partial_default") -> tuple[MarkerSpec, ...]:
    """Six markers named QPrism1..6 under one of the allele-name presets."""
    if preset not in _PRESETS:
        raise ValueError(f"Unknown preset: {preset}")
    return tuple(_PRESETS[preset](i) for i in range(1, 7))


def _marker_default(i: int) -> MarkerSpec:
    return MarkerSpec(f"QPrism{i}")


def _marker_partial(i: int) -> MarkerSpec:
    if i == 1:
        return MarkerSpec("QPrism1", AlleleSpec("MT", "VIC"), AlleleSpec("WT", "FAM"))
    return _marker_default(i)


def _marker_user(i: int) -> MarkerSpec:
    return MarkerSpec(
        f"QPrism{i}", AlleleSpec(f"MUT{i}", "VIC"), AlleleSpec(f"REF{i}", "FAM")
    )


def _marker_half_user(i: int) -> MarkerSpec:
    if i == 1:
        return MarkerSpec(
            "QPrism1", AlleleSpec("Allele 1", "VIC"), AlleleSpec("WT", "FAM")
        )
    return _marker_default(i)


def _marker_same_reporter(i: int) -> MarkerSpec:
    return MarkerSpec(
        f"QPrism{i}", AlleleSpec(f"A{i}", "FAM"), AlleleSpec(f"B{i}", "FAM")
    )


_PRESETS = {
    "all_default": _marker_default,
    "partial_default": _marker_partial,
    "half_user": _marker_half_user,
    "user": _marker_user,
    "same_reporter": _marker_same_reporter,
}


@dataclass(frozen=True)
class StepOneOptions:
    markers: tuple[MarkerSpec, ...] = field(default_factory=default_markers)
    unused_markers: tuple[
        MarkerSpec, ...
    ] = ()  # in experiment.xml, absent from plate_setup.xml
    negative_vic: bool = (
        False  # post-read VIC < 0 on 16 wells (spectral over-correction)
    )
    rox_variation: bool = True  # post/pre ROX ratio 0.77-0.96 instead of 1.0
    line_ending: str = "\r\n"
    trailing_tab: bool = True  # last summary keeps its trailing tab (4 fields, else 3)
    merged_summary: bool = True  # summary glued to the next record line
    corruption: Corruption | None = None
    instrument_type_id: str = "steponeplus"
    seed: int = 7


def marker_wells(options: StepOneOptions) -> dict[str, list[str]]:
    """Marker name -> well IDs. Marker i owns columns 2i+1 and 2i+2 (16 wells)."""
    layout: dict[str, list[str]] = {}
    for i, marker in enumerate(options.markers):
        cols = (2 * i + 1, 2 * i + 2)
        layout[marker.name] = [
            f"{chr(65 + r)}{c}"
            for r in range(PLATE_ROWS)
            for c in cols
            if c <= PLATE_COLS
        ]
    return layout


def build_stepone_eds(options: StepOneOptions | None = None) -> bytes:
    """Return the bytes of a synthetic StepOnePlus ``.eds`` archive."""
    options = options or StepOneOptions()
    members = {
        "apldbio/sds/Manifest.mf": "Manifest-Version: 1.0\r\nCreated-By: synthetic fixture\r\n",
        "apldbio/sds/experiment.xml": _experiment_xml(options),
        "apldbio/sds/plate_setup.xml": _plate_setup_xml(options),
        "apldbio/sds/tcprotocol.xml": _tcprotocol_xml(options),
        "apldbio/sds/multicomponent_data.txt": _multicomponent_text(options),
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, text in members.items():
            zf.writestr(name, text)
    return buf.getvalue()


def write_stepone_eds(path, options: StepOneOptions | None = None) -> None:
    with open(path, "wb") as handle:
        handle.write(build_stepone_eds(options))


# --- experiment.xml / plate_setup.xml ------------------------------------


def _allele_xml(tag: str, allele: AlleleSpec) -> str:
    return (
        f"<{tag}><Name>{allele.name}</Name><Reporter>{allele.reporter}</Reporter>"
        f"<Quencher>NFQ-MGB</Quencher><Color>-256</Color></{tag}>"
    )


def _marker_xml(marker: MarkerSpec) -> str:
    return (
        f"<Name>{marker.name}</Name><Color>-8076815</Color>"
        f"{_allele_xml('Allele1', marker.allele1)}{_allele_xml('Allele2', marker.allele2)}"
    )


def _experiment_xml(options: StepOneOptions) -> str:
    markers = "".join(
        f"<Markers>{_marker_xml(m)}</Markers>"
        for m in (*options.markers, *options.unused_markers)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        "<Experiment><Name>synthetic</Name><RunState>COMPLETED</RunState>"
        f"<Type><Id>{options.instrument_type_id}</Id><Name>StepOnePlus</Name></Type>"
        f"<InstrumentTypeId>{options.instrument_type_id}</InstrumentTypeId>"
        f"{markers}</Experiment>\n"
    )


def _feature_value(index: int, marker: MarkerSpec) -> str:
    return (
        f"<FeatureValue><Index>{index}</Index><FeatureItem><MarkerTaskList><MarkerTask>"
        f"<Task>UNKNOWN</Task><Marker>{_marker_xml(marker)}</Marker>"
        "</MarkerTask></MarkerTaskList></FeatureItem></FeatureValue>"
    )


def _plate_setup_xml(options: StepOneOptions) -> str:
    by_name = {m.name: m for m in options.markers}
    indexed: list[tuple[int, MarkerSpec]] = []
    for name, wells in marker_wells(options).items():
        indexed.extend((_well_index(w), by_name[name]) for w in wells)
    values = "".join(
        _feature_value(i, m) for i, m in sorted(indexed, key=lambda p: p[0])
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        "<Plate><Name>synthetic</Name><Description></Description>"
        f"<Rows>{PLATE_ROWS}</Rows><Columns>{PLATE_COLS}</Columns>"
        f"<PlateKind><Name>96-Well</Name><Type>PLATE_KIND</Type><RowCount>{PLATE_ROWS}</RowCount>"
        f"<ColumnCount>{PLATE_COLS}</ColumnCount></PlateKind>"
        f"<FeatureMap><Feature><Id>marker-task</Id><Name>Marker Task</Name></Feature>{values}"
        "</FeatureMap></Plate>\n"
    )


def _well_index(well: str) -> int:
    return (ord(well[0]) - 65) * PLATE_COLS + int(well[1:]) - 1


# --- tcprotocol.xml --------------------------------------------------------


def _tc_step(collect: bool, temp: float, hold: int) -> str:
    temps = "".join(f"<Temperature>{temp}</Temperature>" for _ in range(6))
    return (
        f"<TCStep><CollectionFlag>{int(collect)}</CollectionFlag><RampRate>1.6</RampRate>"
        f"{temps}<HoldTime>{hold}</HoldTime><ExtTemperature>0.0</ExtTemperature>"
        "<ExtHoldTime>0</ExtHoldTime></TCStep>"
    )


def _tc_stage(
    flag: str, reps: int, steps: list[tuple[bool, float, int]], delta: bool = False
) -> str:
    body = "".join(_tc_step(*s) for s in steps)
    return (
        f"<TCStage><StageFlag>{flag}</StageFlag><NumOfRepetitions>{reps}</NumOfRepetitions>"
        f"<StartingCycle>{1 if flag == 'CYCLING' else 0}</StartingCycle>"
        f"<AutoDeltaEnabled>{'true' if delta else 'false'}</AutoDeltaEnabled>{body}</TCStage>"
    )


def _tcprotocol_xml(options: StepOneOptions) -> str:
    hold_collect = options.corruption == "hold_collection"
    stages = [
        _tc_stage("PRE_READ", 1, [(True, 30.0, 30)]),
        _tc_stage("PRE_CYCLING", 1, [(hold_collect, 94.0, 300)]),
        _tc_stage("CYCLING", 10, [(False, 95.0, 20), (False, 61.0, 60)], delta=True),
        _tc_stage("CYCLING", 15, [(False, 94.0, 15), (False, 60.0, 5)]),
        _tc_stage("CYCLING", 10, [(False, 94.0, 10), (False, 60.0, 30)]),
        _tc_stage(
            "CYCLING", 5, [(False, 94.0, 10), (False, 60.0, 60), (True, 40.0, 10)]
        ),
        _tc_stage("POST_READ", 1, [(True, 30.0, 30)]),
    ]
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        "<TCProtocol><ProtocolName>synthetic</ProtocolName><UserName></UserName>"
        "<RunMode>Fast</RunMode>" + "".join(stages) + "</TCProtocol>\n"
    )


# --- multicomponent_data.txt ----------------------------------------------


def _genotype(well_idx: int) -> int:
    """0 = FAM-strong, 1 = heterozygous-like, 2 = VIC-strong (invented pattern)."""
    return (well_idx // PLATE_COLS + well_idx % PLATE_COLS) % 3


def _read_count(options: StepOneOptions) -> int:
    reads = READS
    if options.corruption == "read_count_mismatch":
        reads -= 1
    if options.corruption == "hold_collection":
        reads += 1
    return reads


def _rox_ratio(well_idx: int, options: StepOneOptions) -> float:
    if not options.rox_variation:
        return 1.0
    return 0.77 + 0.19 * ((well_idx * 37) % 97) / 96  # spans 0.77 .. 0.96


def _signal(
    well_idx: int,
    read: int,
    reads: int,
    dye: str,
    rng: random.Random,
    options: StepOneOptions,
) -> float:
    frac = read / max(reads - 1, 1)
    noise = rng.uniform(-15.0, 15.0)
    if dye == "ROX":
        return 10000.0 * (1 + (_rox_ratio(well_idx, options) - 1) * frac) + noise
    geno = _genotype(well_idx)
    strong = {"FAM": geno in (0, 1), "VIC": geno in (1, 2)}[dye]
    value = 800.0 + (6000.0 if strong else 300.0) * frac + noise
    if (
        dye == "VIC"
        and options.negative_vic
        and read == reads - 1
        and well_idx % 6 == 0
    ):
        return -(1000.0 + well_idx * 20.0)
    return value


def _record_block(
    well_idx: int, read: int, dye: str, value: float, rng: random.Random
) -> list[str]:
    mse = f"{rng.uniform(100.0, 900.0):.4f}"
    head = "\t".join(
        [
            str(well_idx),
            str(read),
            dye,
            mse,
            f"{value:.3f}",
            f"{rng.uniform(0.5, 9.5):.1f}",
        ]
    )
    tails = ["\t" * 5 + f"{rng.uniform(0.5, 9.5):.1f}" for _ in range(3)]
    return [head, *tails]


def _text_blocks(options: StepOneOptions) -> list[tuple[str, list[str]]]:
    """One (summary, [record blocks...]) per (well, read), in file order."""
    rng = random.Random(options.seed)
    reads = _read_count(options)
    out: list[tuple[str, list[str]]] = []
    for well_idx in range(WELLS):
        for read in range(reads):
            summary = f"{well_idx}\t{read}\t{rng.uniform(100.0, 900.0):.4f}"
            blocks = [
                _record_block(
                    well_idx,
                    read,
                    dye,
                    _signal(well_idx, read, reads, dye, rng, options),
                    rng,
                )
                for dye in DYES
            ]
            out.append((summary, ["\n".join(b) for b in blocks]))
    return out


def _apply_block_corruption(
    blocks: list[tuple[str, list[str]]], corruption: str | None
):
    if corruption == "duplicate_record":
        blocks = [*blocks[:10], blocks[9], *blocks[10:]]
    elif corruption == "missing_dye":
        summary, recs = blocks[10]
        blocks = [*blocks[:10], (summary, recs[:1] + recs[2:]), *blocks[11:]]
    return blocks


def _render_lines(
    blocks: list[tuple[str, list[str]]], options: StepOneOptions
) -> list[str]:
    lines = [
        "StepOne v2.0 MulticomponentData",
        "",
        "WELL\tCYCLE\tDYE LIST\tMSE\tSIGNAL DATA\tPURE_DYE_DATA",
    ]
    pending = ""
    for summary, recs in blocks:
        for rec in recs:
            first, *rest = rec.split("\n")
            if pending:
                first = pending + first
                pending = ""
            lines.append(first)
            lines.extend(rest)
        if options.merged_summary:
            pending = summary + "\t"
        else:
            lines.append(summary)
    if pending:
        lines.append(pending if options.trailing_tab else pending.rstrip("\t"))
    elif not options.merged_summary and options.trailing_tab:
        lines[-1] += "\t"
    return lines


def _multicomponent_text(options: StepOneOptions) -> str:
    blocks = _apply_block_corruption(_text_blocks(options), options.corruption)
    lines = _render_lines(blocks, options)
    text = options.line_ending.join(lines)  # the real file has no final line ending
    if options.corruption == "truncated":
        text = text[: len(text) * 2 // 3]
    return text
