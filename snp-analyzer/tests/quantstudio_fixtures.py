"""Synthetic QuantStudio raw ``.eds`` generator for golden tests; invented values only.

Layout matches what ``app.parsers.eds_raw.parse_eds`` reads: ``multicomponentdata.xml``
(``TCStageFlags`` as 1-based stage indices, ``DyeData``/``SignalData`` per well),
``plate_setup.xml``, ``tcprotocol.xml`` and ``experiment.xml``. Not a test module.
"""

from __future__ import annotations

import io
import random
import zipfile
from dataclasses import dataclass

AMP_READS = 23  # plus 1 pre-read and 1 post-read = 25 reads
DYE_ORDER = ("VIC", "FAM", "ROX")


@dataclass(frozen=True)
class QuantStudioOptions:
    rows: int = 8
    cols: int = 12
    markers: tuple[str, ...] = (
        "SNP_A",
        "SNP_B",
    )  # each takes wells_per_marker consecutive wells
    wells_per_marker: int = 24
    declare_plate_type: bool = True  # emit TYPE_<r>X<c> in experiment.xml
    allele2_dye: str = "VIC"
    with_rox: bool = True
    ntc_wells: tuple[int, ...] = ()  # 0-based well indices tagged as NTC
    seed: int = 11


def build_quantstudio_eds(options: QuantStudioOptions | None = None) -> bytes:
    options = options or QuantStudioOptions()
    members = {
        "apldbio/sds/experiment.xml": _experiment_xml(options),
        "apldbio/sds/plate_setup.xml": _plate_setup_xml(options),
        "apldbio/sds/tcprotocol.xml": _tcprotocol_xml(),
        "apldbio/sds/multicomponentdata.xml": _multicomponent_xml(options),
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, text in members.items():
            zf.writestr(name, text)
    return buf.getvalue()


def write_quantstudio_eds(path, options: QuantStudioOptions | None = None) -> None:
    with open(path, "wb") as handle:
        handle.write(build_quantstudio_eds(options))


def assigned_wells(options: QuantStudioOptions) -> list[int]:
    """0-based indices of wells that carry a marker (the first N wells in row-major order)."""
    return list(
        range(
            min(
                options.wells_per_marker * len(options.markers),
                options.rows * options.cols,
            )
        )
    )


def marker_wells(options: QuantStudioOptions) -> dict[str, list[int]]:
    wells = assigned_wells(options)
    size = options.wells_per_marker
    return {
        name: wells[i * size : (i + 1) * size] for i, name in enumerate(options.markers)
    }


def _dyes(options: QuantStudioOptions) -> list[str]:
    dyes = [options.allele2_dye if d == "VIC" else d for d in DYE_ORDER]
    return dyes if options.with_rox else [d for d in dyes if d != "ROX"]


def _experiment_xml(options: QuantStudioOptions) -> str:
    plate = (
        f"<PlateTypeID>TYPE_{options.rows}X{options.cols}</PlateTypeID>"
        if options.declare_plate_type
        else ""
    )
    return f'<?xml version="1.0"?>\n<Experiment><Name>synthetic</Name>{plate}</Experiment>\n'


def _feature_value(index: int, marker: str, task: str) -> str:
    return (
        f"<FeatureValue><Index>{index}</Index><FeatureItem><MarkerTaskList><MarkerTask>"
        f"<Task>{task}</Task><Marker><Name>{marker}</Name></Marker></MarkerTask>"
        "</MarkerTaskList></FeatureItem></FeatureValue>"
    )


def _plate_setup_xml(options: QuantStudioOptions) -> str:
    values = [
        _feature_value(i, name, "NTC" if i in options.ntc_wells else "UNKNOWN")
        for name, wells in marker_wells(options).items()
        for i in wells
    ]
    samples = "".join(
        f"<FeatureValue><Index>{i}</Index><FeatureItem><Sample><Name>S{i + 1}</Name></Sample>"
        "</FeatureItem></FeatureValue>"
        for i in assigned_wells(options)
    )
    return (
        '<?xml version="1.0"?>\n<Plate>'
        f"<FeatureMap><Feature><Id>marker-task</Id></Feature>{''.join(values)}</FeatureMap>"
        f"<FeatureMap><Feature><Id>sample</Id></Feature>{samples}</FeatureMap></Plate>\n"
    )


def _stage(flag: str, reps: int, collect: bool) -> str:
    return (
        f"<TCStage><StageFlag>{flag}</StageFlag><NumOfRepetitions>{reps}</NumOfRepetitions>"
        f"<TCStep><CollectionFlag>{int(collect)}</CollectionFlag><Temperature>60.0</Temperature>"
        "<HoldTime>30</HoldTime></TCStep></TCStage>"
    )


def _tcprotocol_xml() -> str:
    return (
        '<?xml version="1.0"?>\n<TCProtocol>'
        + _stage("PRE_READ", 1, True)
        + _stage("CYCLING", AMP_READS, True)
        + _stage("POST_READ", 1, True)
        + "</TCProtocol>\n"
    )


def _bracket(values: list[float]) -> str:
    return "[" + ", ".join(f"{v:.3f}" for v in values) + "]"


def _well_series(well_idx: int, dye: str, rng: random.Random) -> list[float]:
    total = AMP_READS + 2
    pattern = well_idx % 3
    strong = {"FAM": pattern in (0, 1), "ROX": False}.get(dye, pattern in (1, 2))
    base = 20000.0 if dye == "ROX" else 500.0
    gain = 0.0 if dye == "ROX" else (9000.0 if strong else 200.0)
    return [
        base + gain * i / (total - 1) + rng.uniform(-8.0, 8.0) for i in range(total)
    ]


def _multicomponent_xml(options: QuantStudioOptions) -> str:
    rng = random.Random(options.seed)
    dyes = _dyes(options)
    flags = [1] + [2] * AMP_READS + [3]  # 1-based stage indices of tcprotocol.xml
    flag_text = "[" + ", ".join(str(f) for f in flags) + "]"
    parts = [f"<MulticomponentData><TCStageFlags>{flag_text}</TCStageFlags>"]
    wells = assigned_wells(options)
    for i in wells:
        parts.append(
            f'<DyeData WellIndex="{i}"><DyeList>[{", ".join(dyes)}]</DyeList></DyeData>'
        )
    for i in wells:
        cycles = "".join(
            f"<CycleData>{_bracket(_well_series(i, d, rng))}</CycleData>" for d in dyes
        )
        parts.append(f'<SignalData WellIndex="{i}">{cycles}</SignalData>')
    parts.append("</MulticomponentData>")
    return '<?xml version="1.0"?>\n' + "".join(parts) + "\n"
