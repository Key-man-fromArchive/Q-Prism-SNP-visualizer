"""Large per-well, per-cycle documents are read element by element.

The memory a parse needs follows the values it returns, not the size of the
XML document: processed elements are released as reading goes on, and the
results are the same as when the whole document is held as a tree.
"""

from __future__ import annotations

import gc
import io
import random
import tracemalloc
import zipfile

import pytest

from app.parsers import cfx_xml_parser, pcrd_raw, safe_xml
from app.parsers.eds_raw import _parse_multicomponent, parse_eds
from app.parsers.safe_xml import iterparse_member

from tests.quantstudio_fixtures import QuantStudioOptions, build_quantstudio_eds

PEAK_LIMIT = 250 * 1024 * 1024
MC_MEMBER = "apldbio/sds/multicomponentdata.xml"


def _peak(func):
    """(result, peak traced bytes) of ``func()``."""
    gc.collect()
    tracemalloc.start()
    try:
        result = func()
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    return result, peak


def _zip_with(members: dict[str, bytes]) -> zipfile.ZipFile:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return zipfile.ZipFile(io.BytesIO(buf.getvalue()))


def _replace_multicomponent(eds: bytes, payload: bytes) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(eds)) as src, zipfile.ZipFile(
        out, "w", zipfile.ZIP_DEFLATED
    ) as dst:
        for info in src.infolist():
            data = payload if info.filename == MC_MEMBER else src.read(info)
            dst.writestr(info.filename, data)
    return out.getvalue()


# --- multicomponent data ---------------------------------------------------


def _multicomponent_document(
    wells: int, reads: int, repeats: int = 1, dyes=("VIC", "FAM", "ROX"), padding: bytes = b""
) -> bytes:
    """The structure ``parse_eds`` reads: stage flags, DyeData and SignalData per well."""
    rng = random.Random(5)
    flags = ", ".join(["1"] + ["2"] * (reads - 2) + ["3"])
    parts = [f"<MulticomponentData><TCStageFlags>[{flags}]</TCStageFlags>"]
    dye_list = ", ".join(dyes)
    for _ in range(repeats):
        for well in range(wells):
            parts.append(
                f'<DyeData WellIndex="{well}"><DyeList>[{dye_list}]</DyeList></DyeData>'
            )
    for _ in range(repeats):
        for well in range(wells):
            cycles = "".join(
                "<CycleData>["
                + ", ".join(f"{rng.uniform(100, 60000):.3f}" for _ in range(reads))
                + "]</CycleData>"
                for _dye in dyes
            )
            parts.append(f'<SignalData WellIndex="{well}">{cycles}</SignalData>')
    body = "".join(parts).encode()
    return b'<?xml version="1.0"?>\n' + body + padding + b"</MulticomponentData>\n"


def test_full_plate_multicomponent_document_is_read_within_the_limit():
    document = _multicomponent_document(
        wells=384, reads=1000, dyes=("VIC", "FAM", "ROX", "CY5", "NED")
    )
    assert len(document) > 19 * 1024 * 1024
    zf = _zip_with({MC_MEMBER: document})
    (dye_map, signal_map, stage_flags), peak = _peak(
        lambda: _parse_multicomponent(iterparse_member(zf, MC_MEMBER, "The multicomponent data"))
    )
    assert peak < PEAK_LIMIT
    assert len(dye_map) == len(signal_map) == 384
    assert len(stage_flags) == 1000
    assert all(len(arrays) == 5 and len(arrays[0]) == 1000 for arrays in signal_map.values())


def test_repeated_well_entries_in_a_large_eds_file_are_read_within_the_limit(tmp_path):
    options = QuantStudioOptions()
    document = _multicomponent_document(wells=48, reads=25, repeats=425)
    assert len(document) > 19 * 1024 * 1024
    path = tmp_path / "large.eds"
    path.write_bytes(_replace_multicomponent(build_quantstudio_eds(options), document))

    unified, peak = _peak(lambda: parse_eds(str(path)))
    assert peak < PEAK_LIMIT
    assert len(unified.wells) == 48
    assert len(unified.cycles) == 25


def test_unrelated_elements_in_a_large_document_do_not_accumulate():
    note = b'<Note Id="1"><Item>x</Item></Note>'
    document = _multicomponent_document(
        wells=4, reads=25, padding=note * (8 * 1024 * 1024 // len(note))
    )
    zf = _zip_with({MC_MEMBER: document})
    _, peak = _peak(
        lambda: _parse_multicomponent(iterparse_member(zf, MC_MEMBER, "The multicomponent data"))
    )
    assert peak < 50 * 1024 * 1024


def test_streamed_multicomponent_matches_the_whole_document_read():
    document = _multicomponent_document(wells=12, reads=25, repeats=2)
    root = safe_xml.parse_xml_bytes(document, "doc")
    expected_dyes = {int(e.get("WellIndex")): e.findtext("DyeList") for e in root.iter("DyeData")}
    dye_map, signal_map, flags = _parse_multicomponent(document)
    assert {w: "[" + ", ".join(d) + "]" for w, d in dye_map.items()} == expected_dyes
    expected_signals = {
        int(e.get("WellIndex")): [
            [float(v) for v in c.text.strip("[]").split(",")] for c in e.findall("CycleData")
        ]
        for e in root.iter("SignalData")
    }
    assert signal_map == expected_signals
    assert flags == [1] + [2] * 23 + [3]


# --- .pcrd data ----------------------------------------------------------------


def _pcrd_document(reads: int, junk: int = 0, channels: int = 2) -> bytes:
    rng = random.Random(9)
    layers = "".join(
        f'<dyeLayer plateName="{name}"><fluor channelPosition="{pos}"/><wellSamples>'
        + "".join(
            f'<wellSample plateIndex="{i}" wellSampleType="wcSample" sampleId="S{i}" geneName="M1"/>'
            for i in range(24)
        )
        + "</wellSamples></dyeLayer>"
        for pos, name in enumerate(("FAM", "VIC"))
    )
    protocol = (
        '<protocol2BaseList><TemperatureStep temperatureStepTemp="30" temperatureStepHoldTime="5">'
        "<PlateReadOption/></TemperatureStep>"
        '<TemperatureStep temperatureStepTemp="95" temperatureStepHoldTime="10"/>'
        '<TemperatureStep temperatureStepTemp="60" temperatureStepHoldTime="30"><PlateReadOption/>'
        "</TemperatureStep>"
        '<GotoStep optionGotoStep="1" optionGotoCycle="%d"/></protocol2BaseList>' % (reads - 3)
    )
    plate_reads = []
    for n in range(reads):
        step, cycle = (1, 1) if n == 0 else (3, n)
        values = ";".join(f"{rng.uniform(100, 9000):.2f}" for _ in range(channels * 108 * 4))
        plate_reads.append(
            "<plateRead><PlateRead><Hdr><PlateReadDataHeader>"
            f"<Step>{step}</Step><Cycle>{cycle}</Cycle><ChCount>{channels}</ChCount>"
            "<NumRows>9</NumRows><NumCols>12</NumCols></PlateReadDataHeader></Hdr>"
            f"<Data><PAr>{values}</PAr></Data></PlateRead></plateRead>"
        )
    noise = "".join(f'<Event Id="{i}"><Detail>x</Detail></Event>' for i in range(junk))
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<experimentalData2><header createdByClientAppVersion="5.3.022.1030 (Windows)"/>'
        '<machineProperties machinePropertiesEntry="Block Description : CFX Opus 96"/>'
        f'<plateSetup2 rows="8" columns="12"><dyeLayersList>{layers}</dyeLayersList></plateSetup2>'
        f"<log>{noise}</log>{protocol}"
        f"<runData><plateReadDataVector>{''.join(plate_reads)}</plateReadDataVector></runData>"
        "</experimentalData2>"
    ).encode("utf-8")


@pytest.fixture
def pcrd_file(tmp_path, monkeypatch):
    monkeypatch.setattr(pcrd_raw, "_PCRD_PASSWORD", b"test-key")

    def write(document: bytes) -> str:
        path = tmp_path / "run.pcrd"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("run.xml", b"\xef\xbb\xbf" + document)
        return str(path)

    return write


def test_streamed_pcrd_gives_the_results_of_the_whole_document_read(pcrd_file, monkeypatch):
    document = _pcrd_document(reads=12, junk=50)
    path = pcrd_file(document)
    streamed = pcrd_raw.parse_pcrd(path)

    whole = safe_xml.parse_xml_bytes(document, "doc")
    monkeypatch.setattr(pcrd_raw, "_extract_xml", lambda _p: whole)
    reference = pcrd_raw.parse_pcrd(path)

    assert streamed.model_dump() == reference.model_dump()
    assert streamed.instrument == "CFX Opus 96 (raw)"
    assert streamed.instrument_detail.software == "CFX Maestro 5.3.022.1030"
    assert len(streamed.cycles) == 12
    assert len(streamed.wells) == 24


def test_large_pcrd_document_is_read_within_the_limit(pcrd_file):
    path = pcrd_file(_pcrd_document(reads=1000, junk=0))
    unified, peak = _peak(lambda: pcrd_raw.parse_pcrd(path))
    assert peak < PEAK_LIMIT
    assert len(unified.cycles) == 1000


def test_pcrd_with_many_unrelated_elements_stays_small(pcrd_file):
    path = pcrd_file(_pcrd_document(reads=3, junk=150_000))
    root, peak = _peak(lambda: pcrd_raw._extract_xml(path))
    assert peak < 20 * 1024 * 1024
    assert [child.tag for child in root] == [
        "header",
        "machineProperties",
        "plateSetup2",
        "protocol2BaseList",
        "runData",
    ]


def test_pcrd_read_count_is_bounded_while_reading(pcrd_file):
    path = pcrd_file(_pcrd_document(reads=1001, channels=1))
    with pytest.raises(ValueError, match="at most 1000"):
        pcrd_raw._extract_xml(path)


# --- CFX amplification export ---------------------------------------------------


def test_cfx_amplification_rows_are_read_one_at_a_time(tmp_path):
    wells = [f"{row}{col}" for row in "ABCDEFGH" for col in range(1, 13)]
    rows = "".join(
        f"<Row><Cycle>{cycle}</Cycle>"
        + "".join(f"<{w}>{cycle * 10 + i}.5</{w}>" for i, w in enumerate(wells))
        + "</Row>"
        for cycle in range(1, 41)
    )
    path = tmp_path / "amp.xml"
    path.write_text(f"<FAM>{rows}</FAM>")

    dye, cycles, data = cfx_xml_parser._parse_amplification_xml(str(path))

    assert dye == "FAM"
    assert cycles == list(range(1, 41))
    assert list(data) == wells
    assert data["B3"] == [float(f"{cycle * 10 + 14}.5") for cycle in range(1, 41)]


def test_cfx_amplification_with_a_dtd_is_refused(tmp_path):
    path = tmp_path / "amp.xml"
    path.write_text('<!DOCTYPE FAM [<!ENTITY x "1">]><FAM><Row><Cycle>&x;</Cycle></Row></FAM>')
    with pytest.raises(ValueError, match="document type declaration"):
        cfx_xml_parser._parse_amplification_xml(str(path))


def test_cfx_amplification_that_is_not_well_formed_is_refused(tmp_path):
    path = tmp_path / "amp.xml"
    path.write_text("<FAM><Row><Cycle>1</Cycle></FAM>")
    with pytest.raises(ValueError, match="not well-formed"):
        cfx_xml_parser._parse_amplification_xml(str(path))


# --- shared reader ----------------------------------------------------------------


def test_iterparse_member_checks_the_size_before_reading(monkeypatch):
    zf = _zip_with({"a.xml": b"<a>" + b"<b/>" * 100 + b"</a>"})
    monkeypatch.setattr(safe_xml, "MAX_XML_BYTES", 100)
    with pytest.raises(ValueError, match="larger than an instrument file can be"):
        list(iterparse_member(zf, "a.xml", "The document"))


@pytest.mark.parametrize(
    ("document", "message"),
    [
        (b'<!DOCTYPE a [<!ENTITY x "1">]><a>&x;</a>', "document type declaration"),
        (b'<!DOCTYPE a SYSTEM "a.dtd"><a/>', "document type declaration"),
        (b"<a><b></a>", "not well-formed"),
    ],
)
def test_iterparse_member_maps_refusals_to_the_fixed_messages(document, message):
    zf = _zip_with({"a.xml": document})
    with pytest.raises(ValueError, match=message):
        list(iterparse_member(zf, "a.xml", "The document"))


def test_iterparse_member_reads_utf16_documents():
    document = '<?xml version="1.0" encoding="UTF-16"?><a><b>1</b></a>'.encode("utf-16")
    zf = _zip_with({"a.xml": document})
    ends = [e.tag for event, e in iterparse_member(zf, "a.xml", "d", events=("end",))]
    assert ends == ["b", "a"]


def test_pruned_stream_keeps_wrappers_of_kept_elements_only():
    document = b"<r><skip><x/></skip><wrap><skip/><keep>t</keep></wrap><last/></r>"
    zf = _zip_with({"a.xml": document})

    def classify(elem, ancestors):
        return safe_xml.KEEP if elem.tag == "keep" else None

    stream = safe_xml.PrunedStream(iterparse_member(zf, "a.xml", "d"), classify)
    for _ in stream:
        pass
    assert [c.tag for c in stream.root] == ["wrap"]
    assert [c.tag for c in stream.root.find("wrap")] == ["keep"]

