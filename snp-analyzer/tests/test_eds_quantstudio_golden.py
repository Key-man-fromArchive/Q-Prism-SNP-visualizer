"""Golden tests pinning ``parse_eds`` for synthetic QuantStudio files.

The digest covers the whole ``UnifiedData`` so any behavioural drift while
moving shared helpers into ``eds_common`` is caught. Inputs are synthetic.
"""

import hashlib
import importlib
import json

import pytest

from app.parsers.eds_raw import parse_eds
from tests.quantstudio_fixtures import (
    QuantStudioOptions,
    build_quantstudio_eds,
    write_quantstudio_eds,
)

SHARED_NAMES = (
    "ROW_LABELS",
    "STAGE_LABELS",
    "well_index_to_id",
    "_find_file",
    "_well_sort_key",
    "_parse_plate_dims",
    "_parse_plate_metadata",
    "_parse_protocol",
    "_parse_stage_type_map",
)

# sha256 of the canonical JSON dump, captured before the eds_common move.
GOLDEN = {
    "default": "0ef8afd866f0d2e984d8fc355379847fddd9b07d4697e4274a3575323e550315",
    "ntc_hex_no_rox": "d709f46d108761c633d60aff059ad1831f26d854c487f862f6be2a533efbf60e",
    "plate_384": "be78a821025b3ffe7074843df1ceef13e4690f0e638a224a8fdcbdf796baa316",
}


def _options(name: str) -> QuantStudioOptions:
    if name == "default":
        return QuantStudioOptions()
    if name == "ntc_hex_no_rox":
        return QuantStudioOptions(
            allele2_dye="HEX", with_rox=False, ntc_wells=(0, 5, 30), wells_per_marker=12
        )
    return QuantStudioOptions(rows=16, cols=24, wells_per_marker=100, markers=("M1", "M2", "M3"))


def _digest(path) -> str:
    dumped = parse_eds(str(path)).model_dump(mode="json")
    blob = json.dumps(dumped, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()


@pytest.mark.parametrize("name", sorted(GOLDEN))
def test_parse_eds_matches_golden_digest(tmp_path, name):
    path = tmp_path / f"{name}.eds"
    write_quantstudio_eds(path, _options(name))
    assert _digest(path) == GOLDEN[name]


def test_default_layout_semantics(tmp_path):
    path = tmp_path / "d.eds"
    write_quantstudio_eds(path)
    unified = parse_eds(str(path))
    assert unified.instrument == "QuantStudio 3 (raw)"
    assert unified.allele2_dye == "VIC"
    assert unified.has_rox is True
    assert len(unified.wells) == 48
    assert unified.cycles == list(range(1, 26))
    assert [w.name for w in unified.data_windows] == ["Pre-read", "Amplification", "Post-read"]
    assert sorted(unified.imported_markers) == ["SNP_A", "SNP_B"]
    assert len(unified.data) == 48 * 25
    assert unified.sample_names["A1"] == "S1"
    assert unified.ntc_wells is None


def test_ntc_and_hex_semantics(tmp_path):
    path = tmp_path / "n.eds"
    write_quantstudio_eds(path, _options("ntc_hex_no_rox"))
    unified = parse_eds(str(path))
    assert unified.allele2_dye == "HEX"
    assert unified.has_rox is False
    # Well index 30 is outside the 24 assigned wells, so it is dropped.
    assert unified.ntc_wells == ["A1", "A6"]


def test_384_plate_instrument_label(tmp_path):
    path = tmp_path / "p.eds"
    write_quantstudio_eds(path, _options("plate_384"))
    unified = parse_eds(str(path))
    assert unified.instrument == "QuantStudio (raw, 384-well)"
    assert "P24" not in unified.wells
    assert "E1" in unified.wells


def test_build_is_deterministic():
    assert build_quantstudio_eds() == build_quantstudio_eds()


def test_eds_common_defines_shared_helpers():
    common = importlib.import_module("app.parsers.eds_common")
    raw = importlib.import_module("app.parsers.eds_raw")
    for name in SHARED_NAMES:
        assert hasattr(common, name), name
        assert getattr(raw, name) is getattr(common, name), name


def test_eds_common_does_not_import_eds_raw():
    common = importlib.import_module("app.parsers.eds_common")
    assert not hasattr(common, "parse_eds")
    source = open(common.__file__, encoding="utf-8").read()
    assert "eds_raw" not in source.replace('"""', "")
