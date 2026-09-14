"""P28: the single choke point that turns a session_id into a live session.

Every router used to do its own::

    if sid not in sessions:
        raise HTTPException(404, "Session not found")
    return sessions[sid]

against the plain in-memory ``app.routers.upload.sessions`` dict. That dict
has never been anything but a process-local cache -- ``app/db.py`` has
persisted every session's full data (and its clustering result / manual
well types / markers / manual well groups / sample name overrides /
protocol override) since v0.2.0 -- but nothing ever read a COLD session back
out of it on demand. A process restart (or, with the bound below, an LRU
eviction) left the dict empty while the DB still held everything, so a
session that had been fully analysed before the restart could not be
reopened at all.

``get_session()`` is the fix: on a cache hit it is a plain dict lookup: on a
miss it reconstructs the session AND every dependent in-memory cache from
the DB in one step (via ``app.db.load_session`` -- the same per-session
reconstruction ``load_all_sessions`` already used for the old eager
startup-restore path, so there is exactly one implementation of "what a
session's full memory footprint is").

Restoring only ``UnifiedData`` and leaving the dependent caches (manual well
types, markers, manual well groups, sample name overrides, protocol
override) at their empty defaults would silently change what a later
re-analysis computes -- clustering reads ``marker_store``/``welltype_store``
straight out of process memory (see ``app.routers.clustering._capture_analysis``).
A restored session with an empty ``marker_store`` would re-analyse the WHOLE
plate as one marker instead of the marker set that actually produced the
saved result. This module restores all of them together so that never
happens silently.

Never returns a synthesized empty session: a sid absent from the DB is a
genuine 404, surfaced by returning ``None`` (see ``get_session``).
"""

from __future__ import annotations

from collections import OrderedDict
from threading import RLock

from fastapi import HTTPException

from app.config import SESSION_CACHE_MAX_ENTRIES
from app.models import UnifiedData

# Recency order for the bounded in-memory cache: least-recently-used first.
# Only sids this module has restored or touched are tracked here -- a fresh
# upload registers itself via touch_session() (see app.services.import_session).
_access_order: "OrderedDict[str, None]" = OrderedDict()
_lock = RLock()


def touch_session(sid: str) -> None:
    """Mark sid as most-recently-used and enforce the cache bound.

    Safe to call for a sid that is not yet tracked (first touch) or already
    tracked (re-ordered to most-recent).
    """
    with _lock:
        _access_order.pop(sid, None)
        _access_order[sid] = None
    _evict_if_over_capacity()


def _in_flight_sids() -> set[str]:
    """Sessions with a publication currently pending must never be evicted:

    ripping their UnifiedData out of ``sessions`` mid-computation would
    corrupt that analysis, not just cost a future cache miss.
    """
    from app.processing.analysis_state import publication_states

    return {sid for sid, state in publication_states.items() if state.pending}


def _evict_if_over_capacity() -> None:
    from app.routers.upload import sessions as session_store
    from app.routers.clustering import (
        cluster_store,
        welltype_store,
        group_store,
        marker_store,
    )
    from app.routers.sample import sample_name_store
    from app.routers.data import protocol_store

    with _lock:
        overflow = len(_access_order) - SESSION_CACHE_MAX_ENTRIES
        if overflow <= 0:
            return
        protected = _in_flight_sids()
        evictable = [sid for sid in _access_order if sid not in protected]
        for sid in evictable[:overflow]:
            _access_order.pop(sid, None)
            session_store.pop(sid, None)
            cluster_store.pop(sid, None)
            welltype_store.pop(sid, None)
            group_store.pop(sid, None)
            marker_store.pop(sid, None)
            sample_name_store.pop(sid, None)
            protocol_store.pop(sid, None)


def restore_session(sid: str) -> UnifiedData | None:
    """Return sid's live UnifiedData, restoring the process-local caches from
    the DB first if this is a cold cache. Returns None if sid does not exist
    in the DB either -- callers must treat that as a genuine 404, never as
    "restore succeeded with nothing".
    """
    from app.routers.upload import sessions as session_store

    unified = session_store.get(sid)
    if unified is not None:
        touch_session(sid)
        return unified

    from app import db

    entry = db.load_session(sid)
    if entry is None:
        return None

    from app.models import MarkerRegion
    from app.routers.clustering import (
        cluster_store,
        welltype_store,
        group_store,
        marker_store,
    )
    from app.routers.sample import sample_name_store
    from app.routers.data import protocol_store

    session_store[sid] = entry["unified"]
    if entry["clustering"] is not None:
        cluster_store[sid] = entry["clustering"]
    if entry["welltypes"]:
        welltype_store[sid] = entry["welltypes"]
    if entry["sample_overrides"]:
        sample_name_store[sid] = entry["sample_overrides"]
    if entry["protocol_override"]:
        protocol_store[sid] = entry["protocol_override"]
    if entry["markers"]:
        marker_store[sid] = [MarkerRegion(**m) for m in entry["markers"]]

    manual_groups = db.load_well_groups(sid)
    if manual_groups:
        group_store[sid] = manual_groups

    touch_session(sid)
    return entry["unified"]


def forget_session(sid: str) -> None:
    """Drop sid from LRU recency tracking (e.g. after the session is deleted).

    Deletion itself already pops sid from every in-memory cache (see
    app.routers.sample._delete_sessions_impl); without this the sid would
    linger in _access_order forever, permanently shrinking the effective
    cache bound by one slot per deletion.
    """
    with _lock:
        _access_order.pop(sid, None)


def get_session(sid: str) -> UnifiedData:
    """restore_session(), raising the routers' conventional 404 on a miss.

    The single call sites that need a different detail message (e.g.
    ``compare.py`` embeds the sid) call ``restore_session`` directly instead.
    """
    unified = restore_session(sid)
    if unified is None:
        raise HTTPException(404, "Session not found")
    return unified
