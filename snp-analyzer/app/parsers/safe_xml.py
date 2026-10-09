"""Bounded reading and parsing of the XML documents inside instrument files.

Instrument files are ZIP archives of XML documents. Every document is read
through this module so that the same limits apply everywhere:

* a member larger than an instrument writes is refused before it is read;
* documents that declare a DTD or entities are refused (instruments do not
  write them), whatever the text encoding of the document;
* the archive directory is inspected before the archive is opened, so an
  archive with an unreasonable number of entries is refused up front.

Documents that hold per-well, per-cycle data are read element by element
(``iterparse_member`` / ``iterparse_file`` with ``PrunedStream``), so the memory
needed follows the values kept, not the size of the document.
"""

from __future__ import annotations

import os
import struct
import zipfile
from collections.abc import Callable, Iterator, Sequence
from typing import BinaryIO
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


def iterparse_stream(
    stream: BinaryIO, what: str, events: Sequence[str] = ("start", "end")
) -> Iterator[tuple[str, _ET.Element]]:
    """Read one XML document incrementally with the options ``parse_xml_bytes`` uses.

    Raises the same ``XmlRefused`` errors (``dtd`` / ``malformed``). A leading
    UTF-8 byte-order mark is skipped.
    """
    try:
        head = stream.read(3)
        if head != b"\xef\xbb\xbf":
            stream = _Prefixed(head, stream)
        yield from _safe_et.iterparse(
            stream,
            events=tuple(events),
            forbid_dtd=True,
            forbid_entities=True,
            forbid_external=True,
        )
    except DefusedXmlException:
        raise XmlRefused(
            f"{what} has a document type declaration, which is not accepted", "dtd"
        ) from None
    except (_ET.ParseError, UnicodeError, ValueError, RecursionError):
        raise XmlRefused(f"{what} is not well-formed XML", "malformed") from None


class _Prefixed:
    """A readable stream that first returns bytes already taken from ``rest``."""

    def __init__(self, head: bytes, rest: BinaryIO):
        self._head = head
        self._rest = rest

    def read(self, size: int = -1) -> bytes:
        if self._head:
            if size is None or size < 0:
                data, self._head = self._head + self._rest.read(), b""
                return data
            data, self._head = self._head[:size], self._head[size:]
            if len(data) < size:
                data += self._rest.read(size - len(data))
            return data
        return self._rest.read(size)


def iterparse_member(
    zf: zipfile.ZipFile,
    name: str,
    what: str | None = None,
    max_bytes: int | None = None,
    pwd: bytes | None = None,
    events: Sequence[str] = ("start", "end"),
) -> Iterator[tuple[str, _ET.Element]]:
    """Events of an archive member whose declared size is within ``max_bytes``."""
    label = what or name
    check_size(zf.getinfo(name).file_size, label, max_bytes)
    with zf.open(name, pwd=pwd) as stream:
        yield from iterparse_stream(stream, label, events)


def iterparse_file(
    path: str,
    what: str,
    max_bytes: int | None = None,
    events: Sequence[str] = ("start", "end"),
) -> Iterator[tuple[str, _ET.Element]]:
    """Events of an XML file on disk with the same limits as a member."""
    check_size(os.path.getsize(path), what, max_bytes)
    with open(path, "rb") as handle:
        yield from iterparse_stream(handle, what, events)


# What a ``PrunedStream`` classifier returns for an element at its start event.
KEEP = "keep"  # stays in the tree, with its subtree
LEAF = "leaf"  # stays in the tree; its children and text are dropped once it ends
PASS = "pass"  # whole subtree is available at its end event, then it is dropped


class PrunedStream:
    """End events of a document, with processed elements released as reading goes on.

    ``classify(element, ancestors)`` is called for every element when it starts
    and returns ``KEEP``, ``LEAF``, ``PASS`` or ``None``. Elements that are
    ``None`` (and are not wrappers of kept elements) are removed from their
    parent as soon as they end. A ``PASS`` element is handed to the caller at
    its end event with all of its children and is removed afterwards. Iterating
    yields each element at its end event; ``depth`` is then the element's depth
    (the document element is 0) and ``root`` is the document element.
    """

    def __init__(
        self,
        events: Iterator[tuple[str, _ET.Element]],
        classify: Callable[[_ET.Element, Sequence[_ET.Element]], str | None],
    ):
        self._events = events
        self._classify = classify
        self.root: _ET.Element | None = None
        self.depth = 0

    def __iter__(self) -> Iterator[_ET.Element]:
        classify = self._classify
        path: list[_ET.Element] = []
        modes: list[str | None] = []
        wrappers: list[bool] = []  # holds a kept element
        protected = 0  # open elements that are kept or handed to the caller
        for event, elem in self._events:
            if event == "start":
                if not path and self.root is None:
                    self.root = elem
                mode = classify(elem, path)
                if protected:
                    mode = mode and PASS  # nested: kept only while the parent is
                elif mode in (KEEP, LEAF):
                    wrappers[:] = [True] * len(wrappers)
                if mode:
                    protected += 1
                path.append(elem)
                modes.append(mode)
                wrappers.append(False)
                continue
            path.pop()
            mode = modes.pop()
            wrapper = wrappers.pop()
            self.depth = len(path)
            yield elem
            if mode:
                protected -= 1
            if protected or not path:
                continue
            if mode == LEAF:
                del elem[:]
                elem.text = elem.tail = None
            elif mode != KEEP and not wrapper:
                path[-1].remove(elem)
                elem.clear()


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
