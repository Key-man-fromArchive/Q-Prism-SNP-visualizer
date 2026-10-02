"""StepOnePlus ``.eds`` parser: records, read plan, labels, allele names, API.

Inputs are the synthetic generator in ``tests/stepone_fixtures.py``; none of
the values are biological references.
"""

import io
import os
import zipfile
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from app.models import AlleleLabels
from app.parsers import stepone_eds
from app.parsers.detector import detect_and_parse
from app.parsers.eds_raw import parse_eds
from app.processing.ntc_detection import compute_suggested_cycle
from tests import stepone_fixtures as so
from tests.quantstudio_fixtures import QuantStudioOptions, build_quantstudio_eds

MC = "apldbio/sds/multicomponent_data.txt"


def _parse(tmp_path, options: so.StepOneOptions | None = None):
    path = tmp_path / "plate.eds"
    so.write_stepone_eds(path, options)
    return parse_eds(str(path))


def _member_text(options: so.StepOneOptions | None = None) -> str:
    with zipfile.ZipFile(io.BytesIO(so.build_stepone_eds(options))) as zf:
        return zf.read(MC).decode()


# --- text records -----------------------------------------------------------

REC = "{w}\t{c}\t{d}\t{mse}\t{sig}\t1.0"
CONT = "\t\t\t\t\t2.0"


def _block(w, c, dye, sig, mse="111.1"):
    return [REC.format(w=w, c=c, d=dye, mse=mse, sig=sig), CONT, CONT, CONT]


def _tiny(sep="\r\n", glued=True, last_tab=True):
    lines = ["StepOne v2.0 MulticomponentData", "", "WELL\tCYCLE\tDYE LIST"]
    summary = "0\t0\t5.5\t"
    for i, dye in enumerate(so.DYES):
        lines += _block(0, 0, dye, -7.25 + i)
    if glued:
        # summary glued onto the next record line (second read)
        nxt = _block(0, 1, "FAM", 9.0)
        nxt[0] = summary + nxt[0]
        lines += nxt
        for dye, sig in (("ROX", 10.0), ("VIC", 11.0)):
            lines += _block(0, 1, dye, sig)
    lines.append("0\t1\t6.6" + ("\t" if last_tab else ""))
    return sep.join(lines)


def test_text_parser_handles_crlf_glued_summary_and_negative_values():
    records = stepone_eds.parse_multicomponent_text(_tiny())
    assert records[(0, 0)] == {"FAM": -7.25, "ROX": -6.25, "VIC": -5.25}
    assert records[(0, 1)] == {"FAM": 9.0, "ROX": 10.0, "VIC": 11.0}


@pytest.mark.parametrize("sep", ["\r\n", "\n"])
@pytest.mark.parametrize("last_tab", [True, False])
def test_text_parser_accepts_three_or_four_field_final_summary(sep, last_tab):
    records = stepone_eds.parse_multicomponent_text(_tiny(sep=sep, last_tab=last_tab))
    assert len(records) == 2


def test_signal_is_field_four_not_the_mse_column():
    text = _member_text()
    first = next(
        f
        for f in (line.split("\t") for line in text.split("\r\n"))
        if len(f) == 6 and f[2] == "FAM"
    )
    data = parse_eds_from_bytes(so.build_stepone_eds())
    a1 = next(p for p in data.data if p.well == "A1" and p.cycle == 1)
    assert a1.fam == pytest.approx(float(first[4]))
    assert a1.fam != pytest.approx(float(first[3]))


def parse_eds_from_bytes(raw: bytes):
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "plate.eds")
        with open(path, "wb") as handle:
            handle.write(raw)
        return parse_eds(path)


def test_line_cap_rejects_oversized_text(monkeypatch):
    monkeypatch.setattr(stepone_eds, "MAX_LINES", 50)
    with pytest.raises(ValueError, match="too many lines"):
        stepone_eds.parse_multicomponent_text(_member_text())


@pytest.mark.parametrize("corruption", ["truncated", "duplicate_record", "missing_dye"])
def test_corrupt_text_is_a_valueerror_without_the_path(tmp_path, corruption):
    path = tmp_path / "secret-dir-plate.eds"
    so.write_stepone_eds(path, so.StepOneOptions(corruption=corruption))
    with pytest.raises(ValueError) as err:
        parse_eds(str(path))
    assert str(tmp_path) not in str(err.value)
    assert "secret-dir-plate" not in str(err.value)


def test_duplicate_and_missing_dye_errors_carry_a_line_number(tmp_path):
    for corruption in ("duplicate_record", "missing_dye"):
        path = tmp_path / f"{corruption}.eds"
        so.write_stepone_eds(path, so.StepOneOptions(corruption=corruption))
        with pytest.raises(ValueError, match="line \\d+|incomplete"):
            parse_eds(str(path))


def test_empty_file_is_rejected():
    records = stepone_eds.parse_multicomponent_text("title\r\n\r\nheader")
    assert records == {}
    with pytest.raises(ValueError, match="no data records"):
        stepone_eds._validate_records(records)


# --- windows, read labels, read plan -----------------------------------------


def test_windows_and_default_cycle(tmp_path):
    data = _parse(tmp_path)
    assert [(w.name, w.start_cycle, w.end_cycle) for w in data.data_windows] == [
        ("Pre-read", 1, 1),
        ("Amplification", 2, 6),
        ("Post-read", 7, 7),
    ]
    assert data.cycles == [1, 2, 3, 4, 5, 6, 7]
    assert data.default_cycle == 2
    assert data.has_amplification_curve is False


def test_read_labels_carry_actual_pcr_cycle_and_temperature(tmp_path):
    labels = _parse(tmp_path).read_labels
    assert list(labels) == [1, 2, 3, 4, 5, 6, 7]
    second = labels[2]
    assert (second.stage, second.pcr_cycle, second.temperature) == (
        "Amplification",
        36,
        40.0,
    )
    assert [labels[c].pcr_cycle for c in range(2, 7)] == [36, 37, 38, 39, 40]
    assert labels[1].stage == "Pre-read" and labels[1].pcr_cycle is None
    assert labels[7].stage == "Post-read" and labels[7].pcr_cycle is None


def test_plan_reads_multiplies_repeats_by_collecting_steps_and_skips_silent_stages():
    def stage(flag, reps, flags):
        steps = "".join(
            f"<TCStep><CollectionFlag>{f}</CollectionFlag><Temperature>{50 + i}</Temperature></TCStep>"
            for i, f in enumerate(flags)
        )
        return (
            f"<TCStage><StageFlag>{flag}</StageFlag>"
            f"<NumOfRepetitions>{reps}</NumOfRepetitions>{steps}</TCStage>"
        )

    xml = (
        "<TCProtocol>"
        + stage("PRE_READ", 1, [1])
        + stage("CYCLING", 4, [0, 0])
        + stage("CYCLING", 3, [1, 1])
        + stage("POST_READ", 1, [1])
        + "</TCProtocol>"
    ).encode()
    plan = stepone_eds.plan_reads(xml)
    assert len(plan) == 1 + 6 + 1
    assert [r.pcr_cycle for r in plan[1:7]] == [5, 5, 6, 6, 7, 7]


def test_read_count_mismatch_is_an_error_not_a_sequential_fallback(tmp_path):
    with pytest.raises(ValueError, match="reads"):
        _parse(tmp_path, so.StepOneOptions(corruption="read_count_mismatch"))


def test_collection_in_hold_stage_is_unsupported(tmp_path):
    with pytest.raises(ValueError, match="not supported"):
        _parse(tmp_path, so.StepOneOptions(corruption="hold_collection"))


def test_non_steponeplus_instrument_is_unsupported(tmp_path):
    with pytest.raises(ValueError, match="StepOnePlus"):
        _parse(tmp_path, so.StepOneOptions(instrument_type_id="stepone"))


def test_well_index_beyond_96_is_unsupported():
    records = {(96, 0): {"FAM": 1.0, "ROX": 1.0, "VIC": 1.0}}
    with pytest.raises(ValueError, match="96-well"):
        stepone_eds._validate_records(records)


# --- plate content ---------------------------------------------------------


def test_six_markers_sixteen_wells_each_and_96_wells(tmp_path):
    data = _parse(tmp_path)
    assert len(data.wells) == 96
    assert len(data.data) == 96 * 7
    assert len(data.imported_markers) == 6
    assert all(len(w) == 16 for w in data.imported_markers.values())
    assert data.allele2_dye == "VIC" and data.has_rox is True
    assert data.instrument.startswith("StepOnePlus")


def test_negative_signals_are_preserved(tmp_path):
    data = _parse(tmp_path, so.StepOneOptions(negative_vic=True))
    post = [p.allele2 for p in data.data if p.cycle == 7]
    assert sum(v < 0 for v in post) == 16


def test_rox_drift_is_kept_raw(tmp_path):
    data = _parse(tmp_path)
    ratios = [
        next(p.rox for p in data.data if p.well == w and p.cycle == 7)
        / next(p.rox for p in data.data if p.well == w and p.cycle == 1)
        for w in data.wells
    ]
    assert 0.75 < min(ratios) and max(ratios) < 0.98


# --- allele names ----------------------------------------------------------


def test_partial_default_gives_only_the_named_marker(tmp_path):
    data = _parse(tmp_path)
    assert data.imported_marker_alleles == {
        "QPrism1": AlleleLabels(fam="WT", allele2="MT")
    }


def test_all_default_has_no_alleles(tmp_path):
    options = so.StepOneOptions(markers=so.default_markers("all_default"))
    assert _parse(tmp_path, options).imported_marker_alleles is None


def test_user_names_map_by_reporter_not_position(tmp_path):
    options = so.StepOneOptions(markers=so.default_markers("user"))
    alleles = _parse(tmp_path, options).imported_marker_alleles
    assert alleles["QPrism3"] == AlleleLabels(fam="REF3", allele2="MUT3")
    assert len(alleles) == 6


def test_half_user_keeps_file_value_for_the_default_side(tmp_path):
    options = so.StepOneOptions(markers=so.default_markers("half_user"))
    alleles = _parse(tmp_path, options).imported_marker_alleles
    assert alleles == {"QPrism1": AlleleLabels(fam="WT", allele2="Allele 1")}


def test_same_reporter_markers_are_skipped(tmp_path):
    options = so.StepOneOptions(markers=so.default_markers("same_reporter"))
    assert _parse(tmp_path, options).imported_marker_alleles is None


def test_unsupported_reporter_is_skipped():
    exp = (
        "<Experiment><Markers><Name>M</Name>"
        "<Allele1><Name>A</Name><Reporter>CY5</Reporter></Allele1>"
        "<Allele2><Name>B</Name><Reporter>FAM</Reporter></Allele2></Markers></Experiment>"
    ).encode()
    assert stepone_eds.parse_marker_alleles(exp, {"M"}) == {}


def test_unused_marker_is_dropped(tmp_path):
    unused = so.MarkerSpec(
        "Unused", so.AlleleSpec("X", "VIC"), so.AlleleSpec("Y", "FAM")
    )
    options = so.StepOneOptions(unused_markers=(unused,))
    assert "Unused" not in _parse(tmp_path, options).imported_marker_alleles


def _marker_xml(name, a1, a2):
    return (
        f"<Markers><Name>{name}</Name>"
        f"<Allele1><Name>{a1}</Name><Reporter>VIC</Reporter></Allele1>"
        f"<Allele2><Name>{a2}</Name><Reporter>FAM</Reporter></Allele2></Markers>"
    )


def test_duplicate_markers_with_same_mapping_collapse_to_one():
    exp = f"<Experiment>{_marker_xml('M', 'A', 'B')}{_marker_xml('M', 'A', 'B')}</Experiment>"
    assert stepone_eds.parse_marker_alleles(exp.encode(), {"M"}) == {
        "M": AlleleLabels(fam="B", allele2="A")
    }


def test_duplicate_markers_with_conflicting_mapping_get_no_names():
    exp = (
        f"<Experiment>{_marker_xml('M', 'A', 'B')}{_marker_xml('M', 'C', 'D')}"
        f"{_marker_xml('N', 'E', 'F')}</Experiment>"
    )
    result = stepone_eds.parse_marker_alleles(exp.encode(), {"M", "N"})
    assert "M" not in result
    assert result["N"] == AlleleLabels(fam="F", allele2="E")


def test_text_parser_handles_nan_summary_glued_to_next_record():
    text = _tiny().replace("0\t0\t5.5\t", "0\t0\tnan\t")
    records = stepone_eds.parse_multicomponent_text(text)
    assert records[(0, 1)] == {"FAM": 9.0, "ROX": 10.0, "VIC": 11.0}


def test_overlong_allele_name_is_skipped_not_fatal():
    exp = (
        "<Experiment><Markers><Name>M</Name>"
        f"<Allele1><Name>{'x' * 40}</Name><Reporter>VIC</Reporter></Allele1>"
        "<Allele2><Name>B</Name><Reporter>FAM</Reporter></Allele2></Markers></Experiment>"
    ).encode()
    assert stepone_eds.parse_marker_alleles(exp, {"M"}) == {}


# --- suggested cycle ---------------------------------------------------------


def test_suggested_cycle_is_default_cycle(tmp_path):
    data = _parse(tmp_path)
    assert compute_suggested_cycle(data) == 2


def test_default_cycle_outside_cycles_is_ignored(tmp_path):
    data = _parse(tmp_path)
    broken = data.model_copy(update={"default_cycle": 99})
    assert compute_suggested_cycle(broken) != 99


def test_quantstudio_suggestion_is_unchanged(tmp_path):
    path = tmp_path / "qs.eds"
    path.write_bytes(build_quantstudio_eds(QuantStudioOptions()))
    data = parse_eds(str(path))
    assert data.default_cycle is None and data.read_labels is None
    assert data.has_amplification_curve is True
    plain = data.model_copy(update={"default_cycle": None})
    assert compute_suggested_cycle(data) == compute_suggested_cycle(plain)


def test_detector_routes_stepone_eds(tmp_path):
    path = tmp_path / "plate.eds"
    so.write_stepone_eds(path)
    assert detect_and_parse(str(path), "plate.eds").instrument.startswith("StepOnePlus")


def test_missing_both_data_files_keeps_quantstudio_message(tmp_path):
    path = tmp_path / "empty.eds"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("apldbio/sds/experiment.xml", "<Experiment/>")
    with pytest.raises(ValueError, match="multicomponentdata.xml"):
        parse_eds(str(path))


# --- API ----------------------------------------------------------------------


@pytest.fixture
def api(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-stepone-tests",
            "ADMIN_PASSWORD": "StrongerOperatorPassword123!",
            "SNP_AUTH_MODE": "local",
        },
        clear=False,
    )
    env.start()
    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "stepone.sqlite3"
    from app.main import app
    from app.routers import upload

    async def user():
        return TokenData(user_id="user-1", username="user1", role="user")

    app.dependency_overrides[get_current_user] = user
    with TestClient(app) as client:
        conn = db.get_db()
        conn.execute(
            "INSERT OR IGNORE INTO users (id, username, hashed_password, display_name, role) "
            "VALUES (?, ?, ?, ?, ?)",
            ("user-1", "stepone-user", "x", "stepone-user", "user"),
        )
        conn.commit()
        yield client
    app.dependency_overrides.pop(get_current_user, None)
    upload.sessions.clear()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _upload(client):
    response = client.post(
        "/api/upload",
        files={
            "file": ("plate.eds", so.build_stepone_eds(), "application/octet-stream")
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_upload_succeeds_and_suggests_first_amplification_read(api):
    body = _upload(api)
    assert body["suggested_cycle"] == 2
    assert body["num_cycles"] == 7 and body["num_wells"] == 96


@pytest.mark.parametrize("cycle", [1, 2, 3, 4, 5, 6, 7])
def test_scatter_api_works_for_every_read(api, cycle):
    sid = _upload(api)["session_id"]
    response = api.get(f"/api/data/{sid}/scatter", params={"cycle": cycle})
    assert response.status_code == 200, response.text
    assert len(response.json()["points"]) == 96


def test_upload_of_corrupt_stepone_file_is_a_clean_400(api):
    raw = so.build_stepone_eds(so.StepOneOptions(corruption="truncated"))
    response = api.post(
        "/api/upload",
        files={"file": ("bad.eds", raw, "application/octet-stream")},
    )
    assert response.status_code == 400
