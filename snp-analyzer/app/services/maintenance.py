"""Periodic housekeeping for things the app creates but users never see.

One background task, started from the FastAPI lifespan, calls
``run_maintenance()`` every ``SNP_MAINTENANCE_INTERVAL_SECONDS`` (default one
hour, first run about a minute after startup, ``0`` turns it off).

What is cleaned (and what is deliberately NOT):

* import previews past their expiry, together with their spooled files;
* feedback screenshots that were uploaded but never attached to a report and
  are older than 24 hours;
* the stored copy of an uploaded instrument file once its retention window
  (``RAW_FILE_RETENTION_DAYS``) has closed -- the copy only, the analysis
  session and its readings are never touched;
* temp files and folders this app itself created in the system temp dir
  (known name prefixes only) that are older than six hours.

Analysis sessions are customer results and are never deleted here.

Threading: every database write in this app goes through one shared SQLite
connection that request handlers use from the event loop, so the steps that
touch the database run on the event loop too (they are short deletes). Only
the temp-folder scan, which is pure filesystem work, runs in a worker thread.
Each step logs how much it removed and catches its own errors, so one failing
step never stops the others or the loop.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Callable

from starlette.concurrency import run_in_threadpool

from app.config import maintenance_interval_seconds

logger = logging.getLogger(__name__)

FIRST_RUN_DELAY_SECONDS = 60
ORPHAN_ATTACHMENT_MAX_AGE_HOURS = 24
TEMP_FILE_MAX_AGE_SECONDS = 6 * 60 * 60

# Name prefixes of temp entries created by this app:
#   qprism_upload_  spooled uploads / import previews (app.routers.upload)
#   cfx_fixed_      repaired workbook copies (app.parsers.xlsx_fixer)
#   cfx_xml_        unpacked archive folders (app.parsers.cfx_xml_parser)
TEMP_PREFIXES = ("qprism_upload_", "cfx_fixed_", "cfx_xml_")


# --------------------------------------------------------------------------
# Steps
# --------------------------------------------------------------------------


def remove_expired_previews() -> int:
    """Drop import previews past their expiry and delete their files."""
    from app.routers import import_api

    return import_api._cleanup_expired_previews()


def remove_orphan_feedback_attachments() -> int:
    """Delete screenshots never attached to a report, older than 24 hours."""
    from app import db

    return db.cleanup_orphan_feedback_attachments(ORPHAN_ATTACHMENT_MAX_AGE_HOURS)


def remove_expired_raw_files() -> int:
    """Delete stored uploaded-file copies whose retention window has closed.

    Only the copy on disk is removed (the record is marked as expired); the
    session rows stay exactly as they are.
    """
    from app.services import raw_file_storage

    return raw_file_storage.sweep_expired_raw_files()


def _protected_temp_paths() -> set[str]:
    """Spooled files that a live import preview still points at."""
    from app.routers import import_api

    return {str(record.file_path) for record in list(import_api.preview_store.values())}


def remove_stale_temp_files(
    *,
    temp_dir: str | os.PathLike[str] | None = None,
    now: float | None = None,
    max_age_seconds: float = TEMP_FILE_MAX_AGE_SECONDS,
    protected: set[str] | None = None,
) -> int:
    """Remove this app's own leftovers from the temp dir once they are old.

    Only entries whose name starts with one of ``TEMP_PREFIXES``, that belong
    to the current user, are not symbolic links and have not been modified
    for ``max_age_seconds`` are removed.
    """
    root = Path(temp_dir) if temp_dir is not None else Path(tempfile.gettempdir())
    cutoff = (time.time() if now is None else now) - max_age_seconds
    protected = protected or set()
    uid = os.getuid() if hasattr(os, "getuid") else None
    removed = 0
    try:
        entries = list(os.scandir(root))
    except OSError:
        logger.warning("Maintenance: could not list temp dir %s", root)
        return 0
    for entry in entries:
        if not entry.name.startswith(TEMP_PREFIXES) or str(root / entry.name) in protected:
            continue
        try:
            if entry.is_symlink():
                continue
            info = entry.stat(follow_symlinks=False)
            if info.st_mtime > cutoff or (uid is not None and info.st_uid != uid):
                continue
            if entry.is_dir(follow_symlinks=False):
                shutil.rmtree(entry.path)
            else:
                os.unlink(entry.path)
            removed += 1
        except OSError:
            logger.warning("Maintenance: could not remove temp entry %s", entry.name)
    return removed


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------


def _run_step(name: str, step: Callable[[], int]) -> int:
    try:
        count = step()
    except Exception:
        logger.exception("Maintenance step %s failed", name)
        return 0
    logger.info("Maintenance: %s removed %d", name, count)
    return count


async def run_maintenance() -> dict[str, int]:
    """Run every housekeeping step once and return how much each removed."""
    results = {
        "expired_previews": _run_step("expired previews", remove_expired_previews),
        "orphan_attachments": _run_step("orphan feedback attachments", remove_orphan_feedback_attachments),
        "expired_raw_files": _run_step("expired raw file copies", remove_expired_raw_files),
    }
    try:
        protected = _protected_temp_paths()
        results["temp_files"] = await run_in_threadpool(
            _run_step,
            "stale temp files",
            lambda: remove_stale_temp_files(protected=protected),
        )
    except Exception:
        logger.exception("Maintenance step stale temp files failed")
        results["temp_files"] = 0
    return results


async def _maintenance_loop(interval: int) -> None:
    await asyncio.sleep(min(FIRST_RUN_DELAY_SECONDS, interval))
    while True:
        try:
            await run_maintenance()
        except Exception:
            logger.exception("Maintenance run failed")
        await asyncio.sleep(interval)


def start_maintenance_task() -> asyncio.Task | None:
    """Start the periodic task, or return None when the interval is 0."""
    interval = maintenance_interval_seconds()
    if interval <= 0:
        logger.info("Periodic maintenance is turned off")
        return None
    return asyncio.create_task(_maintenance_loop(interval), name="snp-maintenance")


async def stop_maintenance_task(task: asyncio.Task | None) -> None:
    """Cancel the periodic task and wait for it to finish."""
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
