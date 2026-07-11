"""SQLite write-through cache for session persistence."""
import json
import sqlite3
from pathlib import Path

import os as _os

from app.config import SESSION_RETENTION_DAYS

DB_PATH = Path(_os.environ.get("DB_PATH", str(Path(__file__).parent / "data" / "snp_analyzer.db")))

_conn: sqlite3.Connection | None = None


def get_db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA foreign_keys=ON")
        _conn.row_factory = sqlite3.Row
    return _conn


def _get_schema_version(conn: sqlite3.Connection) -> int:
    """Get current schema version, 0 if table doesn't exist."""
    try:
        row = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
        return row[0] or 0
    except sqlite3.OperationalError:
        return 0


def _run_migrations(conn: sqlite3.Connection):
    """Run incremental migrations based on schema_version."""
    current = _get_schema_version(conn)

    if current < 1:
        # Migration 1: Add user_id column to sessions if missing
        cols = [r[1] for r in conn.execute("PRAGMA table_info(sessions)").fetchall()]
        if "user_id" not in cols:
            conn.execute("ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES users(id)")
        conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (1)")

    if current < 2:
        # Migration 2: Add per-well confidence column to clustering_results
        cols = [r[1] for r in conn.execute("PRAGMA table_info(clustering_results)").fetchall()]
        if "confidences_json" not in cols:
            conn.execute("ALTER TABLE clustering_results ADD COLUMN confidences_json TEXT")
        conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (2)")

    if current < 3:
        # Migration 3: store the FULL ClusteringResult as JSON. The legacy
        # columns only kept labels/method/cycle/confidences, silently dropping
        # ploidy, boundaries, offset, offset_uncertain and low_separation — so a
        # hexaploid result reverted to diploid defaults on reload. result_json
        # also carries future per-marker `regions`.
        cols = [r[1] for r in conn.execute("PRAGMA table_info(clustering_results)").fetchall()]
        if "result_json" not in cols:
            conn.execute("ALTER TABLE clustering_results ADD COLUMN result_json TEXT")
        conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (3)")

    if current < 4:
        # Migration 4: marker (assay) definitions become a first-class,
        # persisted resource instead of living only in in-memory well-group
        # selections. This migration adds the table only -- it does NOT
        # back-fill anything. Existing well_groups remain plain selection
        # primitives; every session's marker set starts empty and must be
        # created explicitly via the /markers endpoints. We deliberately do
        # NOT auto-promote well_groups -> markers here.
        conn.execute(
            """CREATE TABLE IF NOT EXISTS marker_regions (
                session_id TEXT NOT NULL,
                marker_id TEXT NOT NULL,
                name TEXT NOT NULL,
                wells_json TEXT NOT NULL,
                ploidy INTEGER NOT NULL DEFAULT 2,
                color TEXT,
                threshold_json TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (session_id, marker_id),
                FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
            )"""
        )
        conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (4)")

    if current < 5:
        # Migration 5: per-user saved plate layout library (S3 dependency). A
        # layout snapshots one session's current marker set (+ optional
        # well-types/sample ids) so it can be applied to a different session
        # later. Scope is the owning user only (no team/org concept exists in
        # TokenData). This migration adds the table only -- it does NOT
        # back-fill any layouts from existing sessions/markers.
        conn.execute(
            """CREATE TABLE IF NOT EXISTS saved_layouts (
                id TEXT PRIMARY KEY,
                owner_user_id TEXT NOT NULL REFERENCES users(id),
                name TEXT NOT NULL,
                snapshot_json TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )"""
        )
        conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (5)")

    conn.commit()


def init_db():
    conn = get_db()
    schema_path = Path(__file__).parent / "db_schema.sql"
    conn.executescript(schema_path.read_text())
    _run_migrations(conn)
    conn.commit()


def save_session(session_id: str, unified, filename: str = "", user_id: str | None = None):
    """Write session metadata + all well cycle data to DB."""
    conn = get_db()
    metadata = {}
    if unified.sample_names:
        metadata["sample_names"] = unified.sample_names
    if unified.protocol_steps:
        metadata["protocol_steps"] = [s.model_dump() for s in unified.protocol_steps]
    if unified.data_windows:
        metadata["data_windows"] = [w.model_dump() for w in unified.data_windows]
    if unified.well_groups:
        metadata["well_groups"] = unified.well_groups
    if unified.normalization_mode is not None:
        metadata["normalization_mode"] = unified.normalization_mode
    if unified.normalization_channel is not None:
        metadata["normalization_channel"] = unified.normalization_channel
    if unified.normalization_dye is not None:
        metadata["normalization_dye"] = unified.normalization_dye
    if unified.role_channels:
        metadata["role_channels"] = unified.role_channels
    metadata["ploidy"] = getattr(unified, "ploidy", 2)

    conn.execute(
        """INSERT OR REPLACE INTO sessions
           (session_id, instrument, num_wells, num_cycles, allele2_dye, has_rox, raw_filename, metadata_json, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (session_id, unified.instrument, len(unified.wells), len(unified.cycles),
         unified.allele2_dye, int(unified.has_rox), filename, json.dumps(metadata), user_id),
    )

    # Batch insert well cycle data
    rows = [
        (session_id, d.well, d.cycle, d.fam, d.allele2, d.rox)
        for d in unified.data
    ]
    conn.executemany(
        "INSERT OR REPLACE INTO well_cycle_data (session_id, well, cycle, fam, allele2, rox) VALUES (?, ?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()


def set_session_ploidy(session_id: str, ploidy: int) -> None:
    """Merge the session's ploidy into its stored metadata_json (no data rewrite)."""
    conn = get_db()
    row = conn.execute(
        "SELECT metadata_json FROM sessions WHERE session_id = ?", (session_id,)
    ).fetchone()
    if row is None:
        return
    metadata = json.loads(row["metadata_json"]) if row["metadata_json"] else {}
    metadata["ploidy"] = int(ploidy)
    conn.execute(
        "UPDATE sessions SET metadata_json = ? WHERE session_id = ?",
        (json.dumps(metadata), session_id),
    )
    conn.commit()


def save_clustering(session_id: str, result):
    """Write clustering result to DB."""
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO clustering_results "
        "(session_id, labels_json, method, cycle, confidences_json, result_json) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            session_id,
            json.dumps(result.assignments),
            result.algorithm,
            result.cycle,
            json.dumps(result.confidences) if result.confidences else None,
            result.model_dump_json(),
        ),
    )
    conn.commit()


def delete_clustering(session_id: str) -> None:
    """Delete a session's persisted clustering result.

    Used to invalidate a stale clustering run (e.g. after the marker set
    that produced it has been edited) so a later GET /cluster does not
    serve results computed against a marker set that no longer exists.
    """
    conn = get_db()
    conn.execute("DELETE FROM clustering_results WHERE session_id = ?", (session_id,))
    conn.commit()


def save_welltype(session_id: str, well: str, welltype: str):
    """Write a single manual welltype override."""
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO manual_welltypes (session_id, well, welltype) VALUES (?, ?, ?)",
        (session_id, well, welltype),
    )
    conn.commit()


def delete_welltypes(session_id: str):
    """Delete all manual welltypes for a session."""
    conn = get_db()
    conn.execute("DELETE FROM manual_welltypes WHERE session_id = ?", (session_id,))
    conn.commit()


def save_sample_override(session_id: str, well: str, name: str):
    """Write a single sample name override."""
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO sample_name_overrides (session_id, well, sample_name) VALUES (?, ?, ?)",
        (session_id, well, name),
    )
    conn.commit()


def delete_sample_overrides(session_id: str):
    """Delete all sample name overrides for a session."""
    conn = get_db()
    conn.execute("DELETE FROM sample_name_overrides WHERE session_id = ?", (session_id,))
    conn.commit()


def save_protocol_override(session_id: str, steps_json: str):
    """Write protocol override."""
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO protocol_overrides (session_id, protocol_json) VALUES (?, ?)",
        (session_id, steps_json),
    )
    conn.commit()


def get_session_owner(session_id: str) -> str | None:
    """Get the user_id that owns a session."""
    conn = get_db()
    row = conn.execute("SELECT user_id FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
    return row["user_id"] if row else None


def save_well_groups(session_id: str, groups: dict[str, list[str]]):
    """Write manual well groups to DB."""
    conn = get_db()
    conn.execute("DELETE FROM well_groups WHERE session_id = ?", (session_id,))
    for name, wells in groups.items():
        conn.execute(
            "INSERT INTO well_groups (session_id, group_name, wells_json) VALUES (?, ?, ?)",
            (session_id, name, json.dumps(wells)),
        )
    conn.commit()


def load_well_groups(session_id: str) -> dict[str, list[str]]:
    """Load manual well groups from DB."""
    conn = get_db()
    rows = conn.execute(
        "SELECT group_name, wells_json FROM well_groups WHERE session_id = ?",
        (session_id,),
    ).fetchall()
    return {r["group_name"]: json.loads(r["wells_json"]) for r in rows}


def delete_well_groups(session_id: str):
    """Delete all manual well groups for a session."""
    conn = get_db()
    conn.execute("DELETE FROM well_groups WHERE session_id = ?", (session_id,))
    conn.commit()


def save_marker_regions(session_id: str, regions: list[dict]):
    """Replace-all: write the session's full marker (assay) definition set.

    Marker definitions own wells/ploidy/color/threshold_config/name only --
    well_type and sample_id stay in manual_welltypes / sample_name_overrides
    and are never duplicated here."""
    conn = get_db()
    conn.execute("DELETE FROM marker_regions WHERE session_id = ?", (session_id,))
    for reg in regions:
        conn.execute(
            "INSERT INTO marker_regions "
            "(session_id, marker_id, name, wells_json, ploidy, color, threshold_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                session_id,
                reg["id"],
                reg["name"],
                json.dumps(reg["wells"]),
                reg.get("ploidy", 2),
                reg.get("color"),
                json.dumps(reg["threshold_config"]) if reg.get("threshold_config") else None,
            ),
        )
    conn.commit()


def load_marker_regions(session_id: str) -> list[dict]:
    """Load the session's marker (assay) definitions from DB."""
    conn = get_db()
    rows = conn.execute(
        "SELECT marker_id, name, wells_json, ploidy, color, threshold_json "
        "FROM marker_regions WHERE session_id = ? ORDER BY rowid",
        (session_id,),
    ).fetchall()
    return [
        {
            "id": r["marker_id"],
            "name": r["name"],
            "wells": json.loads(r["wells_json"]),
            "ploidy": r["ploidy"],
            "color": r["color"],
            "threshold_config": json.loads(r["threshold_json"]) if r["threshold_json"] else None,
        }
        for r in rows
    ]


def delete_marker_regions(session_id: str):
    """Delete all marker definitions for a session."""
    conn = get_db()
    conn.execute("DELETE FROM marker_regions WHERE session_id = ?", (session_id,))
    conn.commit()


def save_layout(layout_id: str, owner_user_id: str, name: str, snapshot: dict) -> None:
    """Insert a new saved plate layout row.

    Layouts are immutable-by-id from the router's perspective (no in-place
    edit endpoint was requested) -- POST /api/layouts and .../copy both
    create a brand new row via this function."""
    conn = get_db()
    conn.execute(
        "INSERT INTO saved_layouts (id, owner_user_id, name, snapshot_json) VALUES (?, ?, ?, ?)",
        (layout_id, owner_user_id, name, json.dumps(snapshot)),
    )
    conn.commit()


def get_layout(layout_id: str) -> dict | None:
    """Load one saved layout by id (owner-agnostic; callers must check
    ownership themselves -- see app.routers.layouts._get_owned_layout)."""
    conn = get_db()
    row = conn.execute(
        "SELECT id, owner_user_id, name, snapshot_json, created_at, updated_at "
        "FROM saved_layouts WHERE id = ?",
        (layout_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "owner_user_id": row["owner_user_id"],
        "name": row["name"],
        "snapshot": json.loads(row["snapshot_json"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_layouts(owner_user_id: str) -> list[dict]:
    """List all layouts owned by one user, newest first."""
    conn = get_db()
    rows = conn.execute(
        "SELECT id, owner_user_id, name, snapshot_json, created_at, updated_at "
        "FROM saved_layouts WHERE owner_user_id = ? ORDER BY created_at DESC",
        (owner_user_id,),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "owner_user_id": r["owner_user_id"],
            "name": r["name"],
            "snapshot": json.loads(r["snapshot_json"]),
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }
        for r in rows
    ]


def delete_layout(layout_id: str) -> None:
    """Delete one saved layout by id (caller must check ownership first)."""
    conn = get_db()
    conn.execute("DELETE FROM saved_layouts WHERE id = ?", (layout_id,))
    conn.commit()


def cleanup_sessions_older_than(days: int = SESSION_RETENTION_DAYS) -> int:
    """Delete persisted sessions older than the configured retention window.

    This only touches SQLite. Run it while the app process is stopped so the
    process-local session caches cannot retain deleted sessions.
    """
    conn = get_db()
    modifier = f"-{max(days, 1)} days"
    cur = conn.execute("DELETE FROM sessions WHERE created_at < datetime('now', ?)", (modifier,))
    conn.commit()
    return cur.rowcount


def load_all_sessions():
    """Load all sessions from DB for startup restore. Returns list of dicts."""
    from app.models import UnifiedData, WellCycleData, ProtocolStep, DataWindow, ClusteringResult

    conn = get_db()
    sessions_data = []

    for row in conn.execute("SELECT * FROM sessions ORDER BY created_at").fetchall():
        sid = row["session_id"]
        metadata = json.loads(row["metadata_json"]) if row["metadata_json"] else {}

        # Load well cycle data
        well_rows = conn.execute(
            "SELECT well, cycle, fam, allele2, rox FROM well_cycle_data WHERE session_id = ? ORDER BY well, cycle",
            (sid,),
        ).fetchall()

        data = [
            WellCycleData(
                well=r["well"],
                cycle=r["cycle"],
                fam=r["fam"],
                allele2=r["allele2"],
                rox=r["rox"],
                normalization_value=r["rox"] if metadata.get("normalization_channel") else None,
            )
            for r in well_rows
        ]
        wells = sorted(set(d.well for d in data))
        cycles = sorted(set(d.cycle for d in data))

        sample_names = metadata.get("sample_names")
        protocol_steps = None
        if "protocol_steps" in metadata:
            protocol_steps = [ProtocolStep(**s) for s in metadata["protocol_steps"]]
        data_windows = None
        if "data_windows" in metadata:
            data_windows = [DataWindow(**w) for w in metadata["data_windows"]]

        well_groups = metadata.get("well_groups")

        unified = UnifiedData(
            instrument=row["instrument"],
            allele2_dye=row["allele2_dye"],
            wells=wells,
            cycles=cycles,
            data=data,
            has_rox=bool(row["has_rox"]),
            sample_names=sample_names,
            protocol_steps=protocol_steps,
            data_windows=data_windows,
            well_groups=well_groups,
            normalization_mode=metadata.get("normalization_mode"),
            normalization_channel=metadata.get("normalization_channel"),
            normalization_dye=metadata.get("normalization_dye"),
            role_channels=metadata.get("role_channels"),
            ploidy=int(metadata.get("ploidy", 2)),
        )

        # Load clustering results
        clustering = None
        cr = conn.execute("SELECT * FROM clustering_results WHERE session_id = ?", (sid,)).fetchone()
        if cr:
            result_json = cr["result_json"] if "result_json" in cr.keys() else None
            if result_json:
                # Full result (ploidy/boundaries/offset/regions) preserved.
                clustering = ClusteringResult.model_validate_json(result_json)
            else:
                # Legacy rows written before migration 3 — reconstruct what we
                # have; polyploid fields fall back to defaults (unavoidable for
                # pre-fix data).
                conf_json = cr["confidences_json"] if "confidences_json" in cr.keys() else None
                clustering = ClusteringResult(
                    algorithm=cr["method"], cycle=cr["cycle"],
                    assignments=json.loads(cr["labels_json"]),
                    confidences=json.loads(conf_json) if conf_json else None,
                )

        # Load manual welltypes
        wt_rows = conn.execute("SELECT well, welltype FROM manual_welltypes WHERE session_id = ?", (sid,)).fetchall()
        welltypes = {r["well"]: r["welltype"] for r in wt_rows}

        # Load sample name overrides
        sn_rows = conn.execute("SELECT well, sample_name FROM sample_name_overrides WHERE session_id = ?", (sid,)).fetchall()
        sample_overrides = {r["well"]: r["sample_name"] for r in sn_rows}

        # Load protocol overrides
        po = conn.execute("SELECT protocol_json FROM protocol_overrides WHERE session_id = ?", (sid,)).fetchone()
        protocol_override = None
        if po:
            protocol_override = [ProtocolStep(**s) for s in json.loads(po["protocol_json"])]

        # Load marker (assay) definitions -- first-class resource, alongside
        # welltypes/groups, so a reload restores a session's marker set.
        markers = load_marker_regions(sid)

        sessions_data.append({
            "session_id": sid,
            "unified": unified,
            "clustering": clustering,
            "welltypes": welltypes,
            "sample_overrides": sample_overrides,
            "protocol_override": protocol_override,
            "markers": markers,
        })

    return sessions_data
