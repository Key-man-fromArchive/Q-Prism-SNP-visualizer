"""Regression tests for .eds plate geometry (96-well vs 384-well).

384-well QuantStudio files use a 16x24 layout with well indices up to 383.
The parser previously hard-coded an 8x12 (96-well) layout, which raised
"string index out of range" on any well index >= 96.
"""

from app.parsers.eds_raw import _parse_plate_dims, well_index_to_id


def test_well_index_to_id_96_well():
    assert well_index_to_id(0, 12) == "A1"
    assert well_index_to_id(11, 12) == "A12"
    assert well_index_to_id(12, 12) == "B1"
    assert well_index_to_id(95, 12) == "H12"


def test_well_index_to_id_384_well():
    # 16x24 layout: rows A..P, cols 1..24
    assert well_index_to_id(0, 24) == "A1"
    assert well_index_to_id(23, 24) == "A24"
    assert well_index_to_id(24, 24) == "B1"
    # index 96 previously overflowed the 8-row "ABCDEFGH" alphabet
    assert well_index_to_id(96, 24) == "E1"
    assert well_index_to_id(383, 24) == "P24"


def test_parse_plate_dims_384():
    assert _parse_plate_dims(b"<PlateTypeID>TYPE_16X24</PlateTypeID>") == (16, 24)


def test_parse_plate_dims_96():
    assert _parse_plate_dims(b"<PlateTypeID>TYPE_8X12</PlateTypeID>") == (8, 12)


def test_parse_plate_dims_missing():
    assert _parse_plate_dims(b"<experiment>no plate type here</experiment>") is None
