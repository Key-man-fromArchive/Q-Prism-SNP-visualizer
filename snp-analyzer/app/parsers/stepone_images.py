"""Dye signals of a StepOnePlus run computed from its raw scan images.

A StepOnePlus ``.eds`` straight from the instrument holds the scans and the
instrument calibrations but not ``multicomponent_data.txt``: StepOne Software
writes that file only when the experiment is analysed and saved. It computes
the signals the same way every time it opens the file, so we can too:

  * each read is four 16-bit TIFF scans (``stageS-cycleC-pointP-{filter}``),
    one column per plate column and the wells of that column along the rows;
  * a well's raw value per filter is the sum of ``ROI_PIXELS`` pixels starting
    at ``floor(peak) - ROI_OFFSET`` in its column (``peaks.ini``);
  * ``background.ini`` is subtracted per well and filter;
  * the four values are fitted by least squares to the well's pure-dye spectra
    (``puredye.ini``) and each dye's amount is divided by its ``norm-factor``.

Checked against three runs saved by StepOne Software v2.3: the raw sums match
``post-roi.dat`` exactly and the signals match ``multicomponent_data.txt`` to
within 0.2 fluorescence units on every well, read and dye.
"""

import re
import struct
import zipfile

import numpy as np

from app.parsers.eds_common import _find_file

FILTERS = ("BLUE", "GREEN", "YELLOW", "RED")
ROI_PIXELS = 55
ROI_OFFSET = 27
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_SCAN_BYTES = 128 * 1024 * 1024
MAX_INI_BYTES = 8 * 1024 * 1024
MAX_TIFF_TAGS = 256

_IMAGE_NAME = re.compile(
    r"(?:^|/)images/stage(\d+)-cycle(\d+)-point(\d+)-(blue|green|yellow|red)\.tiff?$",
    re.IGNORECASE,
)

# TIFF tags used by the instrument's uncompressed grey-scale scans.
_WIDTH, _HEIGHT, _BITS, _COMPRESSION = 256, 257, 258, 259
_STRIP_OFFSETS, _STRIP_BYTES = 273, 279
_USED_TAGS = {_WIDTH, _HEIGHT, _BITS, _COMPRESSION, _STRIP_OFFSETS, _STRIP_BYTES}
_TYPE_SIZES = {3: ("H", 2), 4: ("I", 4)}


def has_scan_images(names: list[str]) -> bool:
    return any(_IMAGE_NAME.search(n) for n in names)


# --- calibration files ----------------------------------------------------


def _read_ini(zf: zipfile.ZipFile, names: list[str], filename: str) -> str:
    path = _find_file(names, filename)
    if not path:
        raise ValueError(f"This StepOne .eds file has no {filename} calibration.")
    if zf.getinfo(path).file_size > MAX_INI_BYTES:
        raise ValueError(f"{filename} is too large")
    return zf.read(path).decode("utf-8", "replace").replace("\r", "")


def _section(text: str, name: str, filename: str) -> str:
    match = re.search(rf"^\[{re.escape(name)}\]\n(.*?)(?=^\[|\Z)", text, re.M | re.S)
    if not match:
        raise ValueError(f"{filename} has no [{name}] section")
    return match.group(1)


def _grid(section: str, key: str, shape: tuple[int, int], where: str) -> np.ndarray:
    match = re.search(rf"^{re.escape(key)}=<<eof\n(.*?)\neof", section, re.M | re.S)
    if not match:
        raise ValueError(f"{where} has no {key} values")
    try:
        grid = np.array(
            [[float(v) for v in line.split(",")] for line in match.group(1).strip().split("\n")]
        )
    except ValueError:
        raise ValueError(f"{where} {key} values are not numeric") from None
    if grid.shape != shape or not np.all(np.isfinite(grid)):
        raise ValueError(f"{where} {key} does not cover the {shape[0]}x{shape[1]} plate")
    return grid


def _filter_grids(text: str, section: str, filename: str, shape) -> np.ndarray:
    """``(rows, cols, filter)`` values of one section."""
    body = _section(text, section, filename)
    where = f"{filename} [{section}]"
    return np.stack([_grid(body, f, shape, where) for f in FILTERS], axis=-1)


# --- scan images ----------------------------------------------------------


def _decode_tiff(data: bytes) -> np.ndarray:
    """Pixels of an uncompressed 16-bit single-channel TIFF as ``(height, width)``.

    Every count and offset in the header is checked against the file itself,
    so the pixels never take more memory than the file they came from.
    """
    if data[:4] == b"II*\x00":
        order = "<"
    elif data[:4] == b"MM\x00*":
        order = ">"
    else:
        raise ValueError("scan image is not a TIFF")
    try:
        (ifd,) = struct.unpack_from(order + "I", data, 4)
        (count,) = struct.unpack_from(order + "H", data, ifd)
        if count > MAX_TIFF_TAGS:
            raise ValueError("scan image TIFF header is not a scan header")
        tags: dict[int, list[int]] = {}
        for i in range(count):
            tag, typ, n, value_at = struct.unpack_from(order + "HHI4s", data, ifd + 2 + 12 * i)
            if tag not in _USED_TAGS or typ not in _TYPE_SIZES or n == 0:
                continue
            code, size = _TYPE_SIZES[typ]
            if n * size <= 4:
                source, start = value_at, 0
            else:
                source, start = data, struct.unpack(order + "I", value_at)[0]
                if start + n * size > len(data):
                    raise struct.error
            tags[tag] = list(struct.unpack_from(f"{order}{n}{code}", source, start))
    except struct.error:
        raise ValueError("scan image TIFF header is truncated") from None
    width, height = tags.get(_WIDTH, [0])[0], tags.get(_HEIGHT, [0])[0]
    if tags.get(_BITS, [0])[0] != 16 or tags.get(_COMPRESSION, [1])[0] != 1:
        raise ValueError("scan image is not an uncompressed 16-bit TIFF")
    offsets, sizes = tags.get(_STRIP_OFFSETS, []), tags.get(_STRIP_BYTES, [])
    if not width or not height or not offsets or len(offsets) != len(sizes):
        raise ValueError("scan image TIFF has no pixel data")
    if len(offsets) > height:
        raise ValueError("scan image TIFF has more strips than rows")
    needed = width * height * 2
    if needed > len(data):
        raise ValueError("scan image TIFF is truncated")
    pixels = bytearray()
    for offset, size in zip(offsets, sizes):
        if offset + size > len(data):
            raise ValueError("scan image TIFF is truncated")
        pixels += data[offset : offset + min(size, needed - len(pixels))]
        if len(pixels) == needed:
            break
    if len(pixels) < needed:
        raise ValueError("scan image TIFF is truncated")
    return np.frombuffer(bytes(pixels), dtype=order + "u2").reshape(height, width)


def _scan_reads(names: list[str]) -> list[dict[str, str]]:
    """Image paths per read, in acquisition order, keyed by filter."""
    reads: dict[tuple[int, int, int], dict[str, str]] = {}
    for name in names:
        match = _IMAGE_NAME.search(name)
        if match:
            stage, cycle, point, colour = match.groups()
            reads.setdefault((int(stage), int(cycle), int(point)), {})[colour.upper()] = name
    for key, files in reads.items():
        if set(files) != set(FILTERS):
            raise ValueError(
                f"Scan of stage {key[0]} cycle {key[1]} is missing a filter image"
            )
    return [reads[k] for k in sorted(reads)]


def _roi_sums(image: np.ndarray, starts: np.ndarray) -> np.ndarray:
    """``(rows, cols)`` sums of ``ROI_PIXELS`` pixels down each column."""
    rows, cols = starts.shape
    if image.shape[1] != cols:
        raise ValueError(f"scan image has {image.shape[1]} columns, plate has {cols}")
    if starts.min() < 0 or starts.max() + ROI_PIXELS > image.shape[0]:
        raise ValueError("peaks.ini places a well outside the scan image")
    totals = np.vstack([np.zeros((1, cols)), np.cumsum(image, axis=0, dtype=np.float64)])
    col_index = np.arange(cols)[None, :]
    return totals[starts + ROI_PIXELS, col_index] - totals[starts, col_index]


# --- signals ----------------------------------------------------------------


def compute_signals(
    zf: zipfile.ZipFile,
    names: list[str],
    dyes: tuple[str, ...],
    rows: int,
    cols: int,
) -> dict[tuple[int, int], dict[str, float]]:
    """``{(well_index, read_index): {dye: signal}}`` like ``multicomponent_data.txt``."""
    shape = (rows, cols)
    peaks = _filter_grids(_read_ini(zf, names, "peaks.ini"), "peaks", "peaks.ini", shape)
    background = _filter_grids(
        _read_ini(zf, names, "background.ini"), "background", "background.ini", shape
    )
    puredye = _read_ini(zf, names, "puredye.ini")
    spectra = np.stack(
        [_filter_grids(puredye, dye, "puredye.ini", shape) for dye in dyes], axis=-1
    )  # rows, cols, filter, dye
    norm = np.stack(
        [
            _grid(_section(puredye, dye, "puredye.ini"), "norm-factor", shape, f"puredye.ini [{dye}]")
            for dye in dyes
        ],
        axis=-1,
    )  # rows, cols, dye
    if np.any(norm == 0):
        raise ValueError("puredye.ini has a zero norm-factor")
    starts = {f: np.floor(peaks[:, :, i]).astype(int) - ROI_OFFSET for i, f in enumerate(FILTERS)}

    scans = _scan_reads(names)
    total = sum(zf.getinfo(files[f]).file_size for files in scans for f in FILTERS)
    if total > MAX_SCAN_BYTES:
        raise ValueError("scan images are too large")
    raw = np.zeros((len(scans), rows, cols, len(FILTERS)))
    for r, files in enumerate(scans):
        for i, f in enumerate(FILTERS):
            info = zf.getinfo(files[f])
            if info.file_size > MAX_IMAGE_BYTES:
                raise ValueError("scan image is too large")
            raw[r, :, :, i] = _roi_sums(_decode_tiff(zf.read(info)), starts[f])

    signals: dict[tuple[int, int], dict[str, float]] = {}
    for row in range(rows):
        for col in range(cols):
            corrected = (raw[:, row, col, :] - background[row, col]).T  # filter, read
            amounts = np.linalg.lstsq(spectra[row, col], corrected, rcond=None)[0]
            amounts /= norm[row, col][:, None]
            for r in range(len(scans)):
                signals[(row * cols + col, r)] = {
                    dye: float(amounts[d, r]) for d, dye in enumerate(dyes)
                }
    return signals
