"""StepOnePlus .eds saved without analysis: signals computed from the scans.

The synthetic archive is the analysed fixture with ``multicomponent_data.txt``
replaced by calibrations and scan images built backwards from its signals, so
the computed signals must come back to the fixture's own values.
"""

import io
import os
import struct
import zipfile
from pathlib import Path

import numpy as np
import pytest

from app.parsers.detector import detect_and_parse
from app.parsers.eds_raw import parse_eds
from app.parsers.stepone_eds import INSTRUMENT_ANALYSED, INSTRUMENT_FROM_IMAGES
from app.parsers.stepone_images import FILTERS, ROI_OFFSET, ROI_PIXELS, _decode_tiff
from tests.stepone_fixtures import build_stepone_eds

ROWS, COLS, HEIGHT = 8, 12, 598
DYES = ("FAM", "ROX", "VIC")
SPECTRA = {
    "FAM": (1.0, 0.41, 0.17, 0.08),
    "ROX": (0.08, 0.03, 0.40, 1.0),
    "VIC": (0.12, 1.0, 0.62, 0.33),
}
NORM = {"FAM": 1.7583334, "ROX": 1.0, "VIC": 0.8565865}
BACKGROUND = 56000.0


def _tiff(pixels: np.ndarray) -> bytes:
    height, width = pixels.shape
    body = pixels.astype("<u2").tobytes()
    entries = [
        (256, 3, 1, width),
        (257, 3, 1, height),
        (258, 3, 1, 16),
        (259, 3, 1, 1),
        (262, 3, 1, 1),
        (273, 4, 1, 8),
        (278, 3, 1, height),
        (279, 4, 1, len(body)),
    ]
    ifd = struct.pack("<H", len(entries)) + b"".join(
        struct.pack("<HHII", *e) for e in entries
    ) + b"\x00\x00\x00\x00"
    return b"II*\x00" + struct.pack("<I", 8 + len(body)) + body + ifd


def _grid_block(key: str, value) -> str:
    rows = [",".join(str(value(r, c)) for c in range(COLS)) for r in range(ROWS)]
    return f"{key}=<<eof\n" + "\n".join(rows) + "\neof\n"


def _peak(row: int, col: int) -> float:
    return 56.4 + 66.4 * row + (col % 3) * 0.7


def _ini(sections: dict[str, str]) -> str:
    return "# Instrument calibration file.\n\n" + "".join(
        f"[{name}]\n{body}\n" for name, body in sections.items()
    )


def _calibrations() -> dict[str, str]:
    peaks = "".join(_grid_block(f, _peak) for f in FILTERS)
    background = "".join(_grid_block(f, lambda r, c: BACKGROUND) for f in FILTERS)
    puredye = {"puredyes": "dyes=FAM,ROX,VIC\n"}
    for dye in DYES:
        body = _grid_block("norm-factor", lambda r, c, d=dye: NORM[d])
        body += "".join(
            _grid_block(f, lambda r, c, d=dye, i=i: SPECTRA[d][i]) for i, f in enumerate(FILTERS)
        )
        puredye[dye] = body
    return {
        "apldbio/sds/calibrations/peaks.ini": _ini({"peaks": peaks}),
        "apldbio/sds/calibrations/background.ini": _ini({"background": background}),
        "apldbio/sds/calibrations/puredye.ini": _ini(puredye),
    }


def _scans(analysed) -> dict[str, bytes]:
    """Scan images whose ROI sums reproduce ``analysed`` signals."""
    by_point = {(p.well, p.cycle): p for p in analysed.data}
    spectra = np.array([SPECTRA[d] for d in DYES]).T  # filter x dye
    images: dict[str, bytes] = {}
    for cycle in analysed.cycles:
        pixels = np.full((len(FILTERS), HEIGHT, COLS), 900.0)
        for row in range(ROWS):
            for col in range(COLS):
                point = by_point[(f"{chr(65 + row)}{col + 1}", cycle)]
                amounts = np.array([point.fam, point.rox, point.allele2])
                raw = BACKGROUND + spectra @ (amounts * np.array([NORM[d] for d in DYES]))
                start = int(np.floor(_peak(row, col))) - ROI_OFFSET
                for i in range(len(FILTERS)):
                    total = int(round(raw[i]))
                    pixels[i, start : start + ROI_PIXELS, col] = total // ROI_PIXELS
                    pixels[i, start, col] += total - (total // ROI_PIXELS) * ROI_PIXELS
        for i, f in enumerate(FILTERS):
            name = f"apldbio/sds/images/stage6-cycle{cycle:03d}-point1-{f.lower()}.tiff"
            images[name] = _tiff(pixels[i])
    return images


def _image_only_eds(drop: tuple[str, ...] = ()) -> tuple[bytes, object]:
    analysed_bytes = build_stepone_eds()
    with zipfile.ZipFile(io.BytesIO(analysed_bytes)) as zf:
        analysed = parse_eds_bytes(analysed_bytes)
        members = {
            n: zf.read(n) for n in zf.namelist() if not n.endswith("multicomponent_data.txt")
        }
    members.update(_calibrations())
    members.update(_scans(analysed))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        for name, data in members.items():
            if not any(name.endswith(d) for d in drop):
                zf.writestr(name, data)
    return buffer.getvalue(), analysed


def parse_eds_bytes(data: bytes):
    path = Path(os.environ.get("TMPDIR", "/tmp")) / f"stepone-{os.getpid()}-{id(data)}.eds"
    path.write_bytes(data)
    try:
        return parse_eds(str(path))
    finally:
        path.unlink()


def test_image_only_file_parses_to_the_analysed_signals():
    data, analysed = _image_only_eds()
    computed = parse_eds_bytes(data)

    assert analysed.instrument == INSTRUMENT_ANALYSED
    assert computed.instrument == INSTRUMENT_FROM_IMAGES
    assert computed.wells == analysed.wells and computed.cycles == analysed.cycles
    assert computed.sample_names == analysed.sample_names
    assert computed.imported_markers == analysed.imported_markers
    assert computed.read_labels == analysed.read_labels
    expected = {(p.well, p.cycle): p for p in analysed.data}
    for point in computed.data:
        want = expected[(point.well, point.cycle)]
        assert point.fam == pytest.approx(want.fam, abs=1.0)
        assert point.allele2 == pytest.approx(want.allele2, abs=1.0)
        assert point.rox == pytest.approx(want.rox, abs=1.0)


def test_detector_routes_image_only_file(tmp_path):
    data, _ = _image_only_eds()
    path = tmp_path / "from-instrument.eds"
    path.write_bytes(data)
    assert detect_and_parse(str(path), path.name).instrument == INSTRUMENT_FROM_IMAGES


@pytest.mark.parametrize("missing", ["peaks.ini", "background.ini", "puredye.ini"])
def test_missing_calibration_is_named(missing):
    data, _ = _image_only_eds(drop=(missing,))
    with pytest.raises(ValueError, match=missing):
        parse_eds_bytes(data)


def test_missing_filter_image_is_rejected():
    data, _ = _image_only_eds(drop=("cycle003-point1-red.tiff",))
    with pytest.raises(ValueError, match="missing a filter image"):
        parse_eds_bytes(data)


def test_read_count_must_match_the_protocol():
    data, _ = _image_only_eds(drop=tuple(f"cycle002-point1-{f.lower()}.tiff" for f in FILTERS))
    with pytest.raises(ValueError, match="Protocol declares"):
        parse_eds_bytes(data)


def test_tiff_decoder_reads_both_byte_orders():
    pixels = np.arange(24, dtype=np.uint16).reshape(2, 12)
    assert np.array_equal(_decode_tiff(_tiff(pixels)), pixels)
    little = _tiff(pixels)
    big = bytearray(b"MM\x00*")
    # Rebuild the same file big-endian: header, body, IFD.
    body = pixels.astype(">u2").tobytes()
    entries = [(256, 3, 1, 12), (257, 3, 1, 2), (258, 3, 1, 16), (259, 3, 1, 1),
               (273, 4, 1, 8), (279, 4, 1, len(body))]
    big += struct.pack(">I", 8 + len(body)) + body + struct.pack(">H", len(entries))
    for tag, typ, n, value in entries:
        packed = struct.pack(">H", value) + b"\x00\x00" if typ == 3 else struct.pack(">I", value)
        big += struct.pack(">HHI", tag, typ, n) + packed
    big += b"\x00\x00\x00\x00"
    assert np.array_equal(_decode_tiff(bytes(big)), pixels)
    with pytest.raises(ValueError, match="not a TIFF"):
        _decode_tiff(b"GIF89a" + little[6:])


_RAW = os.environ.get("QPRISM_STEPONE_RAW_EDS")
_ANALYSED = os.environ.get("QPRISM_STEPONE_ANALYSED_EDS")


@pytest.mark.skipif(
    not (_RAW and _ANALYSED and Path(_RAW).is_file() and Path(_ANALYSED).is_file()),
    reason="QPRISM_STEPONE_RAW_EDS / QPRISM_STEPONE_ANALYSED_EDS not set",
)
def test_real_run_matches_stepone_software():
    """The same run saved straight from the instrument and after analysis."""
    raw, analysed = parse_eds(_RAW), parse_eds(_ANALYSED)
    assert raw.instrument == INSTRUMENT_FROM_IMAGES
    expected = {(p.well, p.cycle): p for p in analysed.data}
    worst = max(
        max(abs(p.fam - e.fam), abs(p.allele2 - e.allele2), abs(p.rox - e.rox))
        for p in raw.data
        for e in [expected[(p.well, p.cycle)]]
    )
    assert worst < 0.5
