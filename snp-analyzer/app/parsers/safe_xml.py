"""Bounded reading and parsing of the XML documents inside instrument files.

Instrument files are ZIP archives of XML documents. Every document is read
through this module so that the same limits apply everywhere:

* a member larger than an instrument writes is refused before it is read;
* documents that declare a DTD or entities are refused (instruments do not
  write them), whatever the text encoding of the document;
* the archive directory is inspected before the archive is opened, so an
  archive with an unreasonable number of entries is refused up front.
"""

from __future__ import annotations

import os
import struct
import zipfile
from xml.etree import ElementTree as _ET

from defusedxml import ElementTree as _safe_et
from defusedxml.common import DefusedXmlException

from app.config import MAX_ZIP_ENTRIES

MAX_XML_BYTES = 25 * 1024 * 1024
# plate_setup / tcprotocol / experiment documents are small; 8 MB is generous.
MAX_AUX_XML_BYTES = 8 * 1024 * 1024
MAX_ZIP_DIRECTORY_BYTES = 1024 * 1024

# Largest plate format and read count the application handles.
MAX_PLATE_WELLS = 384
MAX_PLATE_ROWS = 16
MAX_PLATE_COLS = 24
MAX_PLATE_READS = 1000

_EOCD = b"PK\x05\x06"
_EOCD_SIZE = 22
_EOCD64_LOCATOR_SIZE = 20
_EOCD64_SIZE = 56
_MAX_COMMENT = 0xFFFF


class XmlRefused(ValueError):
    """An XML document that is not accepted; ``kind`` is dtd, malformed or size."""

    def __init__(self, message: str, kind: str):
        super().__init__(message)
        self.kind = kind


def _too_large(what: str) -> XmlRefused:
    return XmlRefused(f"{what} is larger than an instrument file can be", "size")


def check_size(size: int, what: str, max_bytes: int | None = None) -> None:
    if size > (MAX_XML_BYTES if max_bytes is None else max_bytes):
        raise _too_large(what)


def parse_xml_bytes(
    data: bytes, what: str, max_bytes: int | None = None
) -> _ET.Element:
    """Parse one XML document; refuse oversize, DTD/entity and malformed input."""
    check_size(len(data), what, max_bytes)
    try:
        return _safe_et.fromstring(
            data, forbid_dtd=True, forbid_entities=True, forbid_external=True
        )
    except DefusedXmlException:
        raise XmlRefused(
            f"{what} has a document type declaration, which is not accepted", "dtd"
        ) from None
    except (_ET.ParseError, UnicodeError, ValueError, RecursionError):
        raise XmlRefused(f"{what} is not well-formed XML", "malformed") from None


def read_member(
    zf: zipfile.ZipFile,
    name: str,
    what: str | None = None,
    max_bytes: int | None = None,
    pwd: bytes | None = None,
) -> bytes:
    """Read an archive member whose declared size is within ``max_bytes``."""
    label = what or name
    check_size(zf.getinfo(name).file_size, label, max_bytes)
    return zf.read(name, pwd=pwd) if pwd is not None else zf.read(name)


def parse_member(
    zf: zipfile.ZipFile,
    name: str,
    what: str | None = None,
    max_bytes: int | None = None,
) -> _ET.Element:
    label = what or name
    return parse_xml_bytes(read_member(zf, name, label, max_bytes), label, max_bytes)


def parse_xml_file(path: str, what: str, max_bytes: int | None = None) -> _ET.Element:
    """Parse an XML file on disk with the same limits as a member."""
    limit = MAX_XML_BYTES if max_bytes is None else max_bytes
    check_size(os.path.getsize(path), what, limit)
    with open(path, "rb") as handle:
        return parse_xml_bytes(handle.read(limit + 1), what, limit)


def check_declarations(data: bytes, what: str, max_bytes: int | None = None) -> None:
    """Refuse oversize or DTD-carrying documents; malformed ones are left to the caller."""
    try:
        parse_xml_bytes(data, what, MAX_AUX_XML_BYTES if max_bytes is None else max_bytes)
    except XmlRefused as exc:
        if exc.kind != "malformed":
            raise


def check_members(
    zf: zipfile.ZipFile, names: list[str], max_bytes: int | None, what: str = "An archive entry"
) -> None:
    """Refuse an archive whose listed members exceed ``max_bytes``."""
    for name in names:
        check_size(zf.getinfo(name).file_size, f"{what} ({name})", max_bytes)


def check_plate_dims(rows: int, cols: int, what: str = "The plate") -> None:
    """Refuse a declared plate larger than the largest supported format (384 wells)."""
    if (
        rows < 1
        or cols < 1
        or rows > MAX_PLATE_ROWS
        or cols > MAX_PLATE_COLS
        or rows * cols > MAX_PLATE_WELLS
    ):
        raise ValueError(
            f"{what} declares {rows} x {cols} wells; plates of up to "
            f"{MAX_PLATE_WELLS} wells ({MAX_PLATE_ROWS} x {MAX_PLATE_COLS}) are supported"
        )


def check_read_count(count: int, what: str = "The file") -> None:
    if count > MAX_PLATE_READS:
        raise ValueError(
            f"{what} declares {count} reads; at most {MAX_PLATE_READS} are supported"
        )


# --- ZIP directory ---------------------------------------------------------


def _directory_totals(tail: bytes, tail_start: int, handle) -> tuple[int, int] | None:
    """(entry count, directory bytes) from the end-of-central-directory records."""
    pos = tail.rfind(_EOCD)
    while pos >= 0 and pos + _EOCD_SIZE > len(tail):
        pos = tail.rfind(_EOCD, 0, pos)
    if pos < 0:
        return None
    _, _, _, _, entries, dir_size, _, _ = struct.unpack(
        "<4s4H2LH", tail[pos : pos + _EOCD_SIZE]
    )
    if entries != 0xFFFF and dir_size != 0xFFFFFFFF:
        return entries, dir_size
    # ZIP64: the record sits right before its locator, which sits before the EOCD.
    abs_pos = tail_start + pos
    start = abs_pos - _EOCD64_LOCATOR_SIZE - _EOCD64_SIZE
    if start < 0:
        return None
    handle.seek(start)
    block = handle.read(_EOCD64_SIZE + _EOCD64_LOCATOR_SIZE)
    if len(block) < _EOCD64_SIZE + _EOCD64_LOCATOR_SIZE or block[:4] != b"PK\x06\x06":
        return None
    if block[_EOCD64_SIZE : _EOCD64_SIZE + 4] != b"PK\x06\x07":
        return None
    values = struct.unpack("<4sQ2H2L4Q", block[:_EOCD64_SIZE])
    return values[7], values[8]


def check_zip_directory(
    path: str,
    max_entries: int = MAX_ZIP_ENTRIES,
    max_directory_bytes: int = MAX_ZIP_DIRECTORY_BYTES,
) -> None:
    """Refuse an archive with too many entries before its directory is parsed.

    Reads only the trailing end-of-central-directory records. Files that are
    not ZIP archives are left for the caller's own checks.
    """
    with open(path, "rb") as handle:
        handle.seek(0, os.SEEK_END)
        size = handle.tell()
        tail_len = min(size, _MAX_COMMENT + _EOCD_SIZE)
        tail_start = size - tail_len
        handle.seek(tail_start)
        tail = handle.read(tail_len)
        totals = _directory_totals(tail, tail_start, handle)
    if totals is None:
        return
    entries, dir_size = totals
    if entries > max_entries:
        raise ValueError(
            f"ZIP archive contains too many entries ({entries} > {max_entries})"
        )
    if dir_size > max_directory_bytes:
        raise ValueError(
            "ZIP archive directory is larger than an instrument file writes "
            f"({dir_size} > {max_directory_bytes} bytes)"
        )
