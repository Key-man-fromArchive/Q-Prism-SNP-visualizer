"""P7-B: instrument identity read from the file, never guessed."""

# ruff: noqa: F811  (the imported layouts_client fixture is re-declared as a test argument)
import io
import os
import zipfile
from pathlib import Path

import pytest

from app.models import InstrumentDetail
from app.parsers.detector import detect_and_parse
from app.parsers.instrument_detail import eds_instrument_detail
from app.services.import_session import create_session_from_import
from tests.quantstudio_fixtures import build_quantstudio_eds
from tests.stepone_fixtures import build_stepone_eds
from tests.test_layouts import _plate_unified, layouts_client  # noqa: F401

MANIFEST = (
    "Manifest-Version: 1.0\r\n"
    "Implementation-Title: Applied Biosystems StepOne\r\n"
    "Implementation-Version: StepOne Software v2.3\r\n"
)


def _with_members(raw: bytes, replacements: dict[str, str]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw)) as src, zipfile.ZipFile(out, "w") as dst:
        for item in src.infolist():
            if item.filename not in replacements:
                dst.writestr(item.filename, src.read(item.filename))
        for name, text in replacements.items():
            dst.writestr(name, text)
    return out.getvalue()


def _parse(tmp_path, raw: bytes):
    path = tmp_path / "run.eds"
    path.write_bytes(raw)
    return detect_and_parse(str(path), path.name)


def test_stepone_detail_from_experiment_and_manifest(tmp_path):
    raw = _with_members(
        build_stepone_eds(), {"apldbio/sds/Manifest.mf": MANIFEST}
    )
    detail = _parse(tmp_path, raw).instrument_detail
    assert detail == InstrumentDetail(
        vendor="Applied Biosystems",
        model="StepOnePlus",
        software="StepOne Software v2.3",
    )


def test_stepone_without_version_has_no_software(tmp_path):
    detail = _parse(tmp_path, build_stepone_eds()).instrument_detail
    assert detail.model == "StepOnePlus"
    assert detail.software is None


def test_stepone_manifest_continuation_line_is_joined():
    manifest = "Implementation-Version: StepOne Soft\r\n ware v2.3\r\n"
    detail = eds_instrument_detail(b"<Experiment/>", manifest.encode())
    assert detail.software == "StepOne Software v2.3"


@pytest.mark.parametrize(
    ("type_id", "model"), [("steponeplus", "StepOnePlus"), ("stepone", "StepOne")]
)
def test_model_mapping(type_id, model):
    xml = f"<Experiment><InstrumentTypeId>{type_id}</InstrumentTypeId></Experiment>"
    detail = eds_instrument_detail(xml.encode(), None)
    assert (detail.vendor, detail.model, detail.software) == (
        "Applied Biosystems", model, None
    )


def test_nothing_declared_is_none():
    assert eds_instrument_detail(None, None) is None
    assert eds_instrument_detail(b"<Experiment/>", b"Manifest-Version: 1.0\r\n") is None
    assert eds_instrument_detail(b"not xml", None) is None


def test_unknown_instrument_id_is_not_attributed_to_a_vendor():
    xml = b"<Experiment><InstrumentTypeId>acme9000</InstrumentTypeId></Experiment>"
    detail = eds_instrument_detail(xml, None)
    assert (detail.vendor, detail.model) == (None, "acme9000")


def test_quantstudio_eds_reports_only_what_the_file_says(tmp_path):
    # The synthetic fixture declares no instrument type: nothing is invented.
    assert _parse(tmp_path, build_quantstudio_eds()).instrument_detail is None
    raw = _with_members(
        build_quantstudio_eds(),
        {
            "apldbio/sds/experiment.xml": (
                "<Experiment><InstrumentTypeId>quantstudio3</InstrumentTypeId>"
                "</Experiment>"
            ),
            "apldbio/sds/Manifest.mf": (
                "Implementation-Version: QuantStudio Design & Analysis v1.5.2\r\n"
            ),
        },
    )
    detail = _parse(tmp_path, raw).instrument_detail
    assert detail == InstrumentDetail(
        vendor="Applied Biosystems",
        model="QuantStudio 3",
        software="QuantStudio Design & Analysis v1.5.2",
    )


def test_other_formats_declare_nothing():
    # No CFX/xls/xlsx field is documented as carrying a model or software
    # version, so these stay None rather than being inferred from the format.
    from app.parsers import cfx_opus, cfx_xml_parser, generic_table, pcrd_raw, quantstudio

    for module in (cfx_opus, cfx_xml_parser, generic_table, pcrd_raw, quantstudio):
        assert "instrument_detail" not in Path(module.__file__).read_text(encoding="utf-8")


def _import(c, unified):
    return create_session_from_import(
        unified=unified, filename="run.eds", user_id="user-1",
        session_store=c.upload.sessions,
    )


DETAIL = InstrumentDetail(
    vendor="Applied Biosystems", model="StepOnePlus", software="StepOne Software v2.3"
)


def test_upload_response_and_session_info_carry_detail(layouts_client):
    c = layouts_client
    unified = _plate_unified()
    unified.instrument_detail = DETAIL
    response = _import(c, unified)
    assert response.model_dump(mode="json")["instrument_detail"] == DETAIL.model_dump()
    info = c.client.get(f"/api/sessions/{response.session_id}").json()
    assert info["instrument_detail"] == DETAIL.model_dump()
    c.upload.sessions.clear()
    c.clustering.marker_store.clear()
    info = c.client.get(f"/api/sessions/{response.session_id}").json()
    assert info["instrument_detail"] == DETAIL.model_dump()


def test_responses_omit_detail_when_absent(layouts_client):
    c = layouts_client
    response = _import(c, _plate_unified())
    assert response.instrument_detail is None
    info = c.client.get(f"/api/sessions/{response.session_id}").json()
    assert info.get("instrument_detail") is None


_REAL = os.environ.get("QPRISM_STEPONE_EDS")


@pytest.mark.skipif(
    not _REAL or not Path(_REAL).is_file(),
    reason="QPRISM_STEPONE_EDS not set to an existing file",
)
def test_real_stepone_file_detail():
    detail = detect_and_parse(_REAL, Path(_REAL).name).instrument_detail
    assert detail.vendor == "Applied Biosystems"
    assert detail.model == "StepOnePlus"
    # The file spells the product name with a trademark sign; it is kept verbatim.
    assert detail.software == "StepOne™ Software v2.3"
