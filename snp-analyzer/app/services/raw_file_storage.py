"""Durable, best-effort storage for the ORIGINAL bytes of an uploaded
instrument file (P32).

Upload has always parsed the file into readings (well_cycle_data etc.) and
thrown the source bytes away -- ``sessions.raw_filename`` kept only the NAME.
That means a parser fix can never be re-applied to a past upload, and an
operator who loses their own copy has no way to get it back. This module
copies the uploaded file into a per-session directory alongside the SQLite
DB (same volume, so both survive a container restart) and records it in
``session_raw_files`` with a retention window (``RAW_FILE_RETENTION_DAYS``).

Design decisions (see docs/planning/feedback-2026-09-11/evidence/
P32-RAW-FILE.md for the full rationale):

* Path is keyed by SESSION ID, not content hash. A hash-keyed store would
  dedupe identical re-uploads, but then deleting one session's file could
  not simply remove it -- another session might reference the same bytes.
  Session-keyed storage makes "delete this session's file" and "this
  session's file has expired" always a single, unambiguous operation, at
  the cost of not deduping identical re-uploads (uploads are infrequent and
  files are capped at 50 MB, so the trade favours simplicity).
* ``sha256`` is stored for INTEGRITY verification (has the file on disk
  silently corrupted?), not as a dedup key.
* Expiry is computed and stored ONCE, at upload time (``expires_at``), not
  recomputed from ``stored_at`` + the current ``RAW_FILE_RETENTION_DAYS`` on
  every read. Changing the env var must not retroactively move the expiry
  of files already stored under the old window.
* Deletion is REQUEST-DRIVEN, not a background scheduler: this app has none
  (``app.db.cleanup_sessions_older_than`` is itself only ever invoked
  manually), and introducing one was explicitly out of scope for this
  change. ``sweep_expired_raw_files`` is instead called from the read paths
  that already enumerate sessions (GET /api/sessions, GET
  /api/sessions/{sid}, and this module's own status/download entry points),
  so an expired file is removed the next time anyone looks at it.
* Storage failure NEVER raises out of ``store_raw_file``: raw file retention
  rides along with an upload/import that has already fully persisted the
  parsed session (readings + calls) by the time this runs. A full disk or a
  permissions problem here must not turn a successful analysis upload into
  a failed one.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app import db
from app.config import RAW_FILE_RETENTION_DAYS

logger = logging.getLogger(__name__)

STATUS_AVAILABLE = "available"
STATUS_EXPIRED = "expired"
STATUS_MISSING = "missing"
STATUS_NONE = "none"

_READ_CHUNK_SIZE = 1024 * 1024


@dataclass(frozen=True)
class RawFileStatus:
    """The four states a session's raw file can be in, and why.

    - ``none``: no record at all -- either the session predates this
      feature, or storing its file failed at upload time (best-effort; see
      module docstring). Both look identical from here on purpose: neither
      one is an error the user needs to act on.
    - ``available``: on disk right now, not yet expired.
    - ``expired``: the retention window closed and the file was swept.
      Historical metadata (name/size/sha256/when) is preserved so the UI can
      still say what it was and when it disappeared.
    - ``missing``: a row exists, it has NOT expired yet, but the file is not
      on disk. This is an anomaly (e.g. a disk/volume problem), not policy,
      and is logged as a warning so it is distinguishable from ``expired``.
    """

    status: str
    original_filename: str | None = None
    size_bytes: int | None = None
    sha256: str | None = None
    stored_at: str | None = None
    expires_at: str | None = None
    deleted_at: str | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.isoformat()


def _raw_file_dir() -> Path:
    """Storage root. Defaults to a sibling of the SQLite DB (same volume as
    ``DB_PATH`` -- see app/db.py -- so both persist together); overridable
    via ``RAW_FILE_DIR`` for deployments that want it elsewhere. Read live
    off ``db.DB_PATH`` (not cached) so tests that point ``db.DB_PATH`` at a
    temp directory automatically get isolated raw-file storage too, with no
    extra fixture wiring."""
    override = os.environ.get("RAW_FILE_DIR", "").strip()
    if override:
        return Path(override)
    return db.DB_PATH.parent / "raw_uploads"


def store_raw_file(session_id: str, source_path: Path, original_filename: str) -> None:
    """Best-effort copy of ``source_path`` into durable per-session storage,
    plus a ``session_raw_files`` row. Never raises -- see module docstring."""
    dest: Path | None = None
    try:
        session_dir = _raw_file_dir() / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        ext = Path(original_filename).suffix
        dest = session_dir / f"raw{ext}"

        sha256 = hashlib.sha256()
        size = 0
        with open(source_path, "rb") as src, open(dest, "wb") as out:
            while True:
                chunk = src.read(_READ_CHUNK_SIZE)
                if not chunk:
                    break
                sha256.update(chunk)
                size += len(chunk)
                out.write(chunk)

        stored_at = _now()
        expires_at = stored_at + timedelta(days=RAW_FILE_RETENTION_DAYS)
        db.save_raw_file_record(
            session_id=session_id,
            original_filename=original_filename,
            stored_path=str(dest.relative_to(_raw_file_dir())),
            size_bytes=size,
            sha256=sha256.hexdigest(),
            stored_at=_iso(stored_at),
            expires_at=_iso(expires_at),
        )
    except Exception:
        logger.exception(
            "Raw file retention: failed to persist upload for session %s; "
            "the parsed session itself is unaffected.",
            session_id,
        )
        if dest is not None:
            try:
                dest.unlink(missing_ok=True)
            except OSError:
                pass


def _sweep_row_if_expired(row: sqlite3.Row, now_iso: str) -> bool:
    if row["deleted_at"] is not None:
        return True
    if row["expires_at"] > now_iso:
        return False
    path = _raw_file_dir() / row["stored_path"]
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("Raw file retention: could not remove expired file %s", path)
    db.mark_raw_file_deleted(row["session_id"], reason="expired", deleted_at=now_iso)
    return True


def sweep_expired_raw_files(session_ids: list[str] | None = None) -> int:
    """Delete on-disk bytes (and mark the DB row) for every raw file whose
    retention window has closed. ``session_ids``, when given, narrows the
    sweep to those sessions (used by per-session/list endpoints so a single
    status check doesn't scan the whole table). Returns how many rows were
    swept just now (rows already swept earlier don't count)."""
    now_iso = _iso(_now())
    rows = db.list_expired_raw_files(now_iso)
    swept = 0
    for row in rows:
        if session_ids is not None and row["session_id"] not in session_ids:
            continue
        if row["deleted_at"] is None and _sweep_row_if_expired(row, now_iso):
            swept += 1
    return swept


def _status_from_row(row: sqlite3.Row) -> RawFileStatus:
    if row["deleted_at"] is not None:
        return RawFileStatus(
            status=STATUS_EXPIRED,
            original_filename=row["original_filename"],
            size_bytes=row["size_bytes"],
            sha256=row["sha256"],
            stored_at=row["stored_at"],
            expires_at=row["expires_at"],
            deleted_at=row["deleted_at"],
        )
    path = _raw_file_dir() / row["stored_path"]
    if not path.exists():
        logger.warning(
            "Raw file retention: session %s has an un-expired record but no file on disk at %s",
            row["session_id"],
            path,
        )
        return RawFileStatus(
            status=STATUS_MISSING,
            original_filename=row["original_filename"],
            size_bytes=row["size_bytes"],
            sha256=row["sha256"],
            stored_at=row["stored_at"],
            expires_at=row["expires_at"],
        )
    return RawFileStatus(
        status=STATUS_AVAILABLE,
        original_filename=row["original_filename"],
        size_bytes=row["size_bytes"],
        sha256=row["sha256"],
        stored_at=row["stored_at"],
        expires_at=row["expires_at"],
    )


def get_raw_file_status(session_id: str) -> RawFileStatus:
    """Sweep this one session (cheap, single-row) then report its current
    state. See ``RawFileStatus`` for what each state means."""
    sweep_expired_raw_files([session_id])
    row = db.get_raw_file_record(session_id)
    if row is None:
        return RawFileStatus(status=STATUS_NONE)
    return _status_from_row(row)


def bulk_raw_file_status(session_ids: list[str]) -> dict[str, RawFileStatus]:
    """Same as ``get_raw_file_status`` but for a whole page of sessions in
    one DB round trip (used by GET /api/sessions)."""
    if not session_ids:
        return {}
    sweep_expired_raw_files(session_ids)
    rows = db.get_raw_file_records(session_ids)
    return {
        sid: (
            _status_from_row(rows[sid])
            if sid in rows
            else RawFileStatus(status=STATUS_NONE)
        )
        for sid in session_ids
    }


def open_raw_file_path(session_id: str) -> tuple[Path, str] | None:
    """Return ``(absolute_path, original_filename)`` if the raw file is
    available for download right now, else ``None``."""
    status = get_raw_file_status(session_id)
    if status.status != STATUS_AVAILABLE:
        return None
    row = db.get_raw_file_record(session_id)
    if row is None:
        return None
    return _raw_file_dir() / row["stored_path"], row["original_filename"]


def delete_raw_files_for_sessions(session_ids: list[str]) -> None:
    """Remove the on-disk bytes for sessions that are themselves being
    deleted. The DB row disappears via ``ON DELETE CASCADE`` on
    ``sessions``; this only needs to clean up the filesystem. Best-effort,
    like the rest of this module -- a stray leftover directory is a disk
    hygiene issue, not a reason to fail session deletion."""
    for session_id in session_ids:
        session_dir = _raw_file_dir() / session_id
        try:
            if session_dir.exists():
                shutil.rmtree(session_dir)
        except OSError:
            logger.warning(
                "Raw file retention: could not remove storage directory for deleted session %s",
                session_id,
            )
