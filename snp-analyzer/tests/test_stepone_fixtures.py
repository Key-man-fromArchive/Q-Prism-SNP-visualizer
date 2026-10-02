"""Self-tests for the synthetic StepOnePlus and QuantStudio ``.eds`` generators."""

import io
import os
import re
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter

import pytest

from app.parsers.eds_raw import _parse_plate_metadata, parse_eds
from tests import quantstudio_fixtures as qs
from tests import stepone_fixtures as so

MC = "apldbio/sds/multicomponent_data.txt"
RECORDS = so.WELLS * so.READS * len(so.DYES)  # 2016
SUMMARIES = so.WELLS * so.READS  # 672


def _member(data: bytes, name: str) -> bytes:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return zf.read(name)


def _lines(options: so.StepOneOptions | None = None) -> list[str]:
    text = _member(so.build_stepone_eds(options), MC).decode()
    return text.split(options.line_ending if options else "\r\n")


def _records(lines: list[str]) -> list[list[str]]:
    """Fields of every record line (DYE column alphabetic; summaries are skipped)."""
    split = (line.split("\t") for line in lines)
    return [f for f in split if len(f) >= 6 and f[2].isalpha()]


def _field_counts(lines: list[str]) -> Counter:
    return Counter(len(line.split("\t")) for line in lines)


def test_archive_members_and_instrument_id():
    data = so.build_stepone_eds()
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = set(zf.namelist())
    assert {
        "apldbio/sds/experiment.xml",
        "apldbio/sds/plate_setup.xml",
        "apldbio/sds/tcprotocol.xml",
        MC,
        "apldbio/sds/Manifest.mf",
    } <= names
    assert b"<InstrumentTypeId>steponeplus</InstrumentTypeId>" in _member(
        data, "apldbio/sds/experiment.xml"
    )


def test_field_count_distribution_matches_real_structure():
    lines = _lines()
    counts = _field_counts(lines)
    # title/empty line (1), header + record + continuation lines (6), merged (9), last summary (4)
    assert counts[1] == 2
    assert (
        counts[6] == 1 + (RECORDS - (SUMMARIES - 1)) + RECORDS * 3
    )  # 7394 in the real file
    assert counts[9] == SUMMARIES - 1  # 671 in the real file
    assert counts[4] == 1
    assert (
        sum(counts.values()) == len(lines) == 3 + RECORDS * 4 + 1
    )  # 8068 in the real file
    assert lines[-1].count("\t") == 3 and lines[-1].endswith("\t")


def test_last_summary_without_trailing_tab_has_three_fields():
    lines = _lines(so.StepOneOptions(trailing_tab=False))
    assert len(lines[-1].split("\t")) == 3


def test_unmerged_summary_lines_are_separate():
    counts = _field_counts(_lines(so.StepOneOptions(merged_summary=False)))
    assert counts[9] == 0
    assert counts[3] == SUMMARIES - 1 and counts[4] == 1


def test_record_columns_are_signal_in_field_four():
    first = _lines()[3].split("\t")
    assert first[:3] == ["0", "0", "FAM"]
    assert re.fullmatch(r"\d+\.\d{4}", first[3]) and re.fullmatch(
        r"-?\d+\.\d{3}", first[4]
    )
    assert re.fullmatch(r"\d+\.\d", first[5])
    assert _lines()[4].split("\t")[:5] == [""] * 5


def test_crlf_by_default_and_lf_option():
    raw = _member(so.build_stepone_eds(), MC)
    assert b"\r\n" in raw and not re.search(rb"(?<!\r)\n", raw)
    lf = _member(so.build_stepone_eds(so.StepOneOptions(line_ending="\n")), MC)
    assert b"\r" not in lf


def test_deterministic_output():
    assert so.build_stepone_eds() == so.build_stepone_eds()
    other = so.build_stepone_eds(so.StepOneOptions(seed=8))
    assert _member(other, MC) != _member(so.build_stepone_eds(), MC)


def test_protocol_yields_seven_reads():
    root = ET.fromstring(_member(so.build_stepone_eds(), "apldbio/sds/tcprotocol.xml"))
    reads = 0
    for stage in root.findall("TCStage"):
        collecting = sum(
            s.findtext("CollectionFlag") == "1" for s in stage.findall("TCStep")
        )
        reads += collecting * int(stage.findtext("NumOfRepetitions"))
    assert reads == so.READS == len(so.PCR_CYCLES_OF_READS)


def test_markers_layout_two_columns_sixteen_wells_each():
    layout = so.marker_wells(so.StepOneOptions())
    assert list(layout) == [f"QPrism{i}" for i in range(1, 7)]
    assert all(len(w) == 16 for w in layout.values())
    assert layout["QPrism2"][:2] == ["A3", "A4"]
    parsed = _parse_plate_metadata(
        _member(so.build_stepone_eds(), "apldbio/sds/plate_setup.xml")
    )
    _, groups, types = parsed
    assert {k: len(v) for k, v in groups.items()} == {k: 16 for k in layout}
    assert set(types.values()) == {"Unknown"} and len(types) == 96


def _allele_pairs(options: so.StepOneOptions) -> dict[str, tuple]:
    root = ET.fromstring(
        _member(so.build_stepone_eds(options), "apldbio/sds/experiment.xml")
    )
    return {
        m.findtext("Name"): tuple(
            (m.findtext(f"{a}/Name"), m.findtext(f"{a}/Reporter"))
            for a in ("Allele1", "Allele2")
        )
        for m in root.findall("Markers")
    }


def test_allele_name_presets():
    partial = _allele_pairs(so.StepOneOptions())
    assert partial["QPrism1"] == (("MT", "VIC"), ("WT", "FAM"))
    assert partial["QPrism2"] == (("Allele 1", "VIC"), ("Allele 2", "FAM"))
    default = _allele_pairs(
        so.StepOneOptions(markers=so.default_markers("all_default"))
    )
    assert {v for v in default.values()} == {(("Allele 1", "VIC"), ("Allele 2", "FAM"))}
    user = _allele_pairs(so.StepOneOptions(markers=so.default_markers("user")))
    assert user["QPrism3"] == (("MUT3", "VIC"), ("REF3", "FAM"))
    half = _allele_pairs(so.StepOneOptions(markers=so.default_markers("half_user")))
    assert half["QPrism1"] == (("Allele 1", "VIC"), ("WT", "FAM"))
    same = _allele_pairs(so.StepOneOptions(markers=so.default_markers("same_reporter")))
    assert same["QPrism1"][0][1] == same["QPrism1"][1][1] == "FAM"
    with pytest.raises(ValueError):
        so.default_markers("nope")


def test_unused_marker_only_in_experiment_xml():
    extra = so.MarkerSpec("UNUSED1")
    options = so.StepOneOptions(unused_markers=(extra,))
    assert "UNUSED1" in _allele_pairs(options)
    plate = _member(
        so.build_stepone_eds(options), "apldbio/sds/plate_setup.xml"
    ).decode()
    assert "UNUSED1" not in plate


def _post_vic(options: so.StepOneOptions) -> list[float]:
    values = []
    for line in _lines(options):
        f = line.split("\t")
        if len(f) >= 6 and f[2] == "VIC" and f[1] == str(so.READS - 1):
            values.append(float(f[4]))
    return values


def test_negative_vic_option_affects_sixteen_wells():
    assert min(_post_vic(so.StepOneOptions())) > 0
    negatives = [v for v in _post_vic(so.StepOneOptions(negative_vic=True)) if v < 0]
    assert len(negatives) == 16


def _rox_ratios(options: so.StepOneOptions) -> list[float]:
    pre, post = {}, {}
    for line in _lines(options):
        f = line.split("\t")
        if len(f) >= 6 and f[2] == "ROX":
            if f[1] == "0":
                pre[f[0]] = float(f[4])
            elif f[1] == str(so.READS - 1):
                post[f[0]] = float(f[4])
    return [post[w] / pre[w] for w in pre]


def test_rox_variation_range():
    ratios = _rox_ratios(so.StepOneOptions())
    assert 0.76 <= min(ratios) < 0.80 and 0.93 < max(ratios) <= 0.97
    flat = _rox_ratios(so.StepOneOptions(rox_variation=False))
    assert all(abs(r - 1.0) < 0.01 for r in flat)


def test_corruptions_change_the_file_as_described():
    base = _lines()
    short = _lines(so.StepOneOptions(corruption="read_count_mismatch"))
    assert len(short) < len(base)
    assert max(int(f[1]) for f in _records(short)) == so.READS - 2
    cut = _lines(so.StepOneOptions(corruption="truncated"))
    assert len(cut) < len(base) * 0.8
    dup = _lines(so.StepOneOptions(corruption="duplicate_record"))
    assert len(dup) > len(base)
    keys = [tuple(f[:3]) for f in _records(dup)]
    assert len(keys) != len(set(keys))
    missing = _lines(so.StepOneOptions(corruption="missing_dye"))
    assert len(missing) < len(base)
    dyes = Counter(f[2] for f in _records(missing))
    assert dyes["ROX"] == so.WELLS * so.READS - 1


def test_hold_collection_adds_collecting_prestage_and_extra_read():
    data = so.build_stepone_eds(so.StepOneOptions(corruption="hold_collection"))
    root = ET.fromstring(_member(data, "apldbio/sds/tcprotocol.xml"))
    stage = root.findall("TCStage")[1]
    assert stage.findtext("StageFlag") == "PRE_CYCLING"
    assert stage.findtext("TCStep/CollectionFlag") == "1"
    reads = {int(f[1]) for f in _records(_member(data, MC).decode().split("\r\n"))}
    assert len(reads) == so.READS + 1


def test_writes_to_path(tmp_path):
    target = tmp_path / "s.eds"
    so.write_stepone_eds(target)
    assert zipfile.is_zipfile(target)
    qs.write_quantstudio_eds(tmp_path / "q.eds")
    assert zipfile.is_zipfile(tmp_path / "q.eds")


def test_no_customer_values():
    path = os.environ.get("QPRISM_STEPONE_EDS")
    if not path or not os.path.exists(path):
        pytest.skip("customer file not available")
    with zipfile.ZipFile(path) as zf:
        real = zf.read(MC).decode().split("\r\n")
        real_xml = zf.read("apldbio/sds/plate_setup.xml").decode()
    real_values = {f[4] for f in _records(real)}
    mine = {f[4] for f in _records(_lines())}
    assert len(real_values & mine) / len(mine) < 0.01
    generic = {
        "Allele 1",
        "Allele 2",
        "marker-task",
        "Marker Task",
        "96-Well",
        "synthetic",
        "MT",
        "WT",
    }
    real_names = set(re.findall(r"<Name>([^<]{2,})</Name>", real_xml)) - generic
    generated = _member(so.build_stepone_eds(), "apldbio/sds/plate_setup.xml").decode()
    assert not [
        n
        for n in real_names
        if f"<Name>{n}</Name>" in generated and not n.startswith("QPrism")
    ]


def test_quantstudio_fixture_parses_with_existing_parser(tmp_path):
    path = tmp_path / "q.eds"
    qs.write_quantstudio_eds(path)
    data = parse_eds(str(path))
    assert len(data.wells) == 48 and data.cycles == list(range(1, 26))
    assert set(data.imported_markers) == {"SNP_A", "SNP_B"}
    assert data.has_rox and data.allele2_dye == "VIC"
    assert [w.name for w in data.data_windows] == [
        "Pre-read",
        "Amplification",
        "Post-read",
    ]


def test_quantstudio_options(tmp_path):
    path = tmp_path / "q384.eds"
    qs.write_quantstudio_eds(
        path,
        qs.QuantStudioOptions(
            rows=16,
            cols=24,
            markers=("M",),
            wells_per_marker=10,
            allele2_dye="HEX",
            with_rox=False,
            ntc_wells=(0, 1),
        ),
    )
    data = parse_eds(str(path))
    assert data.allele2_dye == "HEX" and not data.has_rox
    assert data.ntc_wells == ["A1", "A2"]
    assert "384" in data.instrument
