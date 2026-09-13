"""SQLite write-through cache for session persistence."""
import json
import sqlite3
from pathlib import Path
from app.models import ClusteringResult, UnifiedData

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


def _migrate_input_revision(conn: sqlite3.Connection, current: int) -> None:
    """Add provenance versioning without rewriting sessions or child rows."""
    # Gated on this migration's OWN stamp rather than on the newest version in
    # the table: once a later migration exists (the feedback tables, 8),
    # MAX(version) overshoots 7 on a database that has not actually had this
    # one applied, and a "current >= 7" guard would skip it forever.
    if current >= 7 and conn.execute(
        "SELECT version FROM schema_version WHERE version = 7"
    ).fetchone():
        return
    columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
    if "input_revision" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN input_revision "
                     "INTEGER NOT NULL DEFAULT 0 CHECK (input_revision >= 0)")
    conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (7)")


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

    if current < 6:
        # Migration 6: durable, user-scoped MARKER (assay) CATALOG -- a
        # reusable assay registry that transcends a single plate/session
        # (unlike marker_regions, which is per-session and ephemeral).
        # marker_regions gains a nullable catalog_id so a session marker can
        # OPTIONALLY link back to the catalog entry it was attached from
        # (see POST /api/data/{sid}/markers/{marker_id}/attach-catalog). This
        # migration adds the table/column only -- it does NOT back-fill any
        # catalog entries from existing marker_regions rows.
        conn.execute(
            """CREATE TABLE IF NOT EXISTS marker_catalog (
                id TEXT PRIMARY KEY,
                owner_user_id TEXT NOT NULL REFERENCES users(id),
                name TEXT NOT NULL,
                target_gene TEXT,
                snp_id TEXT,
                allele1_base TEXT,
                allele2_base TEXT,
                chemistry TEXT,
                default_ploidy INTEGER NOT NULL DEFAULT 2,
                color TEXT,
                expected_dosage_classes INTEGER,
                interpretation_notes TEXT,
                asg_target_id TEXT,
                calibration_json TEXT,
                validation_json TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )"""
        )
        cols = [r[1] for r in conn.execute("PRAGMA table_info(marker_regions)").fetchall()]
        if "catalog_id" not in cols:
            conn.execute("ALTER TABLE marker_regions ADD COLUMN catalog_id TEXT")
        conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (6)")

    _migrate_input_revision(conn, current)

    if current < 8:
        # Migration 8: in-app user FEEDBACK (bug reports / requests) plus its
        # comment thread and screenshot attachments. db_schema.sql is re-run on
        # every startup, so the CREATE statements there already cover an
        # existing DB; this branch exists so the version bookkeeping stays
        # honest about when the tables appeared, and adds the indexes for a DB
        # that somehow has the tables without them. It back-fills nothing --
        # there is no prior feedback anywhere to migrate from.
        conn.execute(
            """CREATE TABLE IF NOT EXISTS user_feedback (
                id TEXT PRIMARY KEY,
                owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                category TEXT NOT NULL CHECK (category IN ('bug', 'feature', 'improvement', 'question', 'other')),
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                context_json TEXT,
                status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
                admin_note TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS user_feedback_comments (
                id TEXT PRIMARY KEY,
                feedback_id TEXT NOT NULL REFERENCES user_feedback(id) ON DELETE CASCADE,
                author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                body TEXT NOT NULL,
                is_admin INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS user_feedback_attachments (
                id TEXT PRIMARY KEY,
                feedback_id TEXT REFERENCES user_feedback(id) ON DELETE CASCADE,
                owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                content BLOB NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )"""
        )
        for index_sql in (
            "CREATE INDEX IF NOT EXISTS idx_user_feedback_owner ON user_feedback (owner_user_id)",
            "CREATE INDEX IF NOT EXISTS idx_user_feedback_status ON user_feedback (status)",
            "CREATE INDEX IF NOT EXISTS idx_user_feedback_comments_feedback ON user_feedback_comments (feedback_id)",
            "CREATE INDEX IF NOT EXISTS idx_user_feedback_attachments_feedback ON user_feedback_attachments (feedback_id)",
            "CREATE INDEX IF NOT EXISTS idx_user_feedback_attachments_owner ON user_feedback_attachments (owner_user_id)",
        ):
            conn.execute(index_sql)
        conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (8)")

    if current < 9:
        # Migration 9 (P22 C5): record which clustering algorithm revision
        # produced a stored result (see
        # app.processing.clustering.CLUSTERING_ALGORITHM_VERSION), so a later
        # reproducibility question -- "was this row computed before or after
        # fix X?" -- can be answered by reading the row instead of
        # re-deriving it. Nullable, no back-fill: existing rows predate the
        # concept and there is no knowable version to assign them.
        cols = [r[1] for r in conn.execute("PRAGMA table_info(clustering_results)").fetchall()]
        if "algorithm_version" not in cols:
            conn.execute("ALTER TABLE clustering_results ADD COLUMN algorithm_version TEXT")
        conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (9)")
    conn.commit()


def init_db():
    conn = get_db()
    schema_path = Path(__file__).parent / "db_schema.sql"
    conn.executescript(schema_path.read_text())
    _run_migrations(conn)
    conn.commit()


def save_session(session_id: str, unified: UnifiedData, filename: str = "", user_id: str | None = None) -> None:
    """Write session metadata + all well cycle data to DB."""
    conn = get_db()
    metadata: dict[str, object] = {}
    if unified.sample_names:
        metadata["sample_names"] = unified.sample_names
    if unified.imported_well_types:
        metadata["imported_well_types"] = unified.imported_well_types
    if unified.imported_markers:
        metadata["imported_markers"] = unified.imported_markers
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
    if unified.background_mode is not None:
        metadata["background_mode"] = unified.background_mode
    if unified.ntc_wells:
        metadata["ntc_wells"] = unified.ntc_wells
    metadata["ploidy"] = getattr(unified, "ploidy", 2)

    conn.execute(
        """INSERT OR REPLACE INTO sessions
           (session_id, instrument, num_wells, num_cycles, allele2_dye, has_rox, raw_filename, metadata_json, user_id, input_revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (session_id, unified.instrument, len(unified.wells), len(unified.cycles),
         unified.allele2_dye, int(unified.has_rox), filename, json.dumps(metadata), user_id, unified.input_revision),
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


def set_session_ploidy(session_id: str, ploidy: int, *, commit: bool = True) -> None:
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
    if commit:
        conn.commit()


def save_clustering(session_id: str, result: ClusteringResult) -> None:
    """Atomically save result and provenance; failed commits leave no pending write.

    The caller must publish to memory only after this succeeds. Session-level
    computation ordering/CAS belongs to the analysis publisher, not this writer.
    """
    conn = get_db()
    values = (
        session_id, json.dumps(result.assignments), result.algorithm, result.cycle,
        json.dumps(result.confidences) if result.confidences is not None else None,
        result.model_dump_json(),
        result.algorithm_version,
    )
    try:
        conn.execute(
            "INSERT OR REPLACE INTO clustering_results "
            "(session_id, labels_json, method, cycle, confidences_json, result_json, algorithm_version) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)", values,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def delete_clustering(session_id: str) -> None:
    """Delete a session's persisted clustering result.

    Used to invalidate a stale clustering run (e.g. after the marker set
    that produced it has been edited) so a later GET /cluster does not
    serve results computed against a marker set that no longer exists.
    """
    conn = get_db()
    conn.execute("DELETE FROM clustering_results WHERE session_id = ?", (session_id,))
    conn.commit()


def save_welltype(session_id: str, well: str, welltype: str, *, commit: bool = True):
    """Write a single manual welltype override."""
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO manual_welltypes (session_id, well, welltype) VALUES (?, ?, ?)",
        (session_id, well, welltype),
    )
    if commit:
        conn.commit()


def delete_welltypes(session_id: str, *, commit: bool = True):
    """Delete all manual welltypes for a session."""
    conn = get_db()
    conn.execute("DELETE FROM manual_welltypes WHERE session_id = ?", (session_id,))
    if commit:
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


def save_marker_regions(session_id: str, regions: list[dict], *, commit: bool = True):
    """Replace-all: write the session's full marker (assay) definition set.

    Marker definitions own wells/ploidy/color/threshold_config/name only --
    well_type and sample_id stay in manual_welltypes / sample_name_overrides
    and are never duplicated here."""
    conn = get_db()
    conn.execute("DELETE FROM marker_regions WHERE session_id = ?", (session_id,))
    for reg in regions:
        conn.execute(
            "INSERT INTO marker_regions "
            "(session_id, marker_id, name, wells_json, ploidy, color, threshold_json, catalog_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                session_id,
                reg["id"],
                reg["name"],
                json.dumps(reg["wells"]),
                reg.get("ploidy", 2),
                reg.get("color"),
                json.dumps(reg["threshold_config"]) if reg.get("threshold_config") else None,
                reg.get("catalog_id"),
            ),
        )
    if commit:
        conn.commit()


def load_marker_regions(session_id: str) -> list[dict]:
    """Load the session's marker (assay) definitions from DB."""
    conn = get_db()
    rows = conn.execute(
        "SELECT marker_id, name, wells_json, ploidy, color, threshold_json, catalog_id "
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
            "catalog_id": r["catalog_id"] if "catalog_id" in r.keys() else None,
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


# ---------------------------------------------------------------------------
# Marker (assay) CATALOG -- durable, user-scoped, plate-independent assay
# registry (see app/routers/marker_catalog.py). calibration/validation are
# stored as JSON blobs (app.models.MarkerCalibration / MarkerValidation).
# ---------------------------------------------------------------------------

_MARKER_CATALOG_COLUMNS = (
    "id", "owner_user_id", "name", "target_gene", "snp_id", "allele1_base",
    "allele2_base", "chemistry", "default_ploidy", "color",
    "expected_dosage_classes", "interpretation_notes", "asg_target_id",
)


def _marker_catalog_row_to_dict(row: sqlite3.Row) -> dict:
    result = {col: row[col] for col in _MARKER_CATALOG_COLUMNS}
    result["calibration"] = json.loads(row["calibration_json"]) if row["calibration_json"] else {}
    result["validation"] = json.loads(row["validation_json"]) if row["validation_json"] else {}
    result["created_at"] = row["created_at"]
    result["updated_at"] = row["updated_at"]
    return result


def save_marker_catalog_entry(entry_id: str, owner_user_id: str, data: dict) -> None:
    """Insert a new catalog entry. ``data`` is a plain dict matching
    ``MarkerCatalogEntry``'s fields (``calibration``/``validation`` as
    dicts, JSON-encoded here)."""
    conn = get_db()
    conn.execute(
        """INSERT INTO marker_catalog
           (id, owner_user_id, name, target_gene, snp_id, allele1_base, allele2_base,
            chemistry, default_ploidy, color, expected_dosage_classes, interpretation_notes,
            asg_target_id, calibration_json, validation_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            entry_id,
            owner_user_id,
            data["name"],
            data.get("target_gene"),
            data.get("snp_id"),
            data.get("allele1_base"),
            data.get("allele2_base"),
            data.get("chemistry"),
            data.get("default_ploidy", 2),
            data.get("color"),
            data.get("expected_dosage_classes"),
            data.get("interpretation_notes", ""),
            data.get("asg_target_id"),
            json.dumps(data.get("calibration") or {}),
            json.dumps(data.get("validation") or {}),
        ),
    )
    conn.commit()


def get_marker_catalog_entry(entry_id: str) -> dict | None:
    """Load one catalog entry by id (owner-agnostic; callers must check
    ownership themselves -- see app.routers.marker_catalog._get_owned_entry)."""
    conn = get_db()
    row = conn.execute("SELECT * FROM marker_catalog WHERE id = ?", (entry_id,)).fetchone()
    if row is None:
        return None
    return _marker_catalog_row_to_dict(row)


def list_marker_catalog_entries(owner_user_id: str) -> list[dict]:
    """List all catalog entries owned by one user, newest first."""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM marker_catalog WHERE owner_user_id = ? ORDER BY created_at DESC",
        (owner_user_id,),
    ).fetchall()
    return [_marker_catalog_row_to_dict(r) for r in rows]


def update_marker_catalog_entry(entry_id: str, data: dict) -> None:
    """Overwrite a catalog entry's editable fields in place (caller must
    check ownership first)."""
    conn = get_db()
    conn.execute(
        """UPDATE marker_catalog SET
               name = ?, target_gene = ?, snp_id = ?, allele1_base = ?,
               allele2_base = ?, chemistry = ?, default_ploidy = ?, color = ?,
               expected_dosage_classes = ?, interpretation_notes = ?,
               asg_target_id = ?, calibration_json = ?, validation_json = ?,
               updated_at = datetime('now')
           WHERE id = ?""",
        (
            data["name"],
            data.get("target_gene"),
            data.get("snp_id"),
            data.get("allele1_base"),
            data.get("allele2_base"),
            data.get("chemistry"),
            data.get("default_ploidy", 2),
            data.get("color"),
            data.get("expected_dosage_classes"),
            data.get("interpretation_notes", ""),
            data.get("asg_target_id"),
            json.dumps(data.get("calibration") or {}),
            json.dumps(data.get("validation") or {}),
            entry_id,
        ),
    )
    conn.commit()


def delete_marker_catalog_entry(entry_id: str) -> None:
    """Delete one catalog entry by id (caller must check ownership first)."""
    conn = get_db()
    conn.execute("DELETE FROM marker_catalog WHERE id = ?", (entry_id,))
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
            input_revision=row["input_revision"],
            instrument=row["instrument"],
            allele2_dye=row["allele2_dye"],
            wells=wells,
            cycles=cycles,
            data=data,
            has_rox=bool(row["has_rox"]),
            sample_names=sample_names,
            imported_well_types=metadata.get("imported_well_types"),
            imported_markers=metadata.get("imported_markers"),
            protocol_steps=protocol_steps,
            data_windows=data_windows,
            well_groups=well_groups,
            normalization_mode=metadata.get("normalization_mode"),
            normalization_channel=metadata.get("normalization_channel"),
            normalization_dye=metadata.get("normalization_dye"),
            role_channels=metadata.get("role_channels"),
            ploidy=int(metadata.get("ploidy", 2)),
            background_mode=metadata.get("background_mode"),
            ntc_wells=metadata.get("ntc_wells"),
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
                algorithm_version = cr["algorithm_version"] if "algorithm_version" in cr.keys() else None
                clustering = ClusteringResult(
                    algorithm=cr["method"], cycle=cr["cycle"],
                    assignments=json.loads(cr["labels_json"]),
                    confidences=json.loads(conf_json) if conf_json else None,
                    algorithm_version=algorithm_version,
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


# ---------------------------------------------------------------------------
# In-app user feedback
#
# Feedback rows are plain DB state -- unlike sessions/markers there is no
# in-memory store mirroring them, so every read goes through these helpers.
# The HTTP layer (app/routers/feedback.py) owns validation and authorization;
# everything here assumes it has already run.
# ---------------------------------------------------------------------------


def _feedback_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "owner_user_id": row["owner_user_id"],
        "category": row["category"],
        "title": row["title"],
        "body": row["body"],
        "context": json.loads(row["context_json"]) if row["context_json"] else None,
        "status": row["status"],
        "admin_note": row["admin_note"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def insert_feedback(
    feedback_id: str,
    owner_user_id: str,
    category: str,
    title: str,
    body: str,
    context: dict | None = None,
) -> None:
    conn = get_db()
    conn.execute(
        "INSERT INTO user_feedback (id, owner_user_id, category, title, body, context_json) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            feedback_id,
            owner_user_id,
            category,
            title,
            body,
            json.dumps(context) if context else None,
        ),
    )
    conn.commit()


def get_feedback(feedback_id: str) -> dict | None:
    conn = get_db()
    row = conn.execute("SELECT * FROM user_feedback WHERE id = ?", (feedback_id,)).fetchone()
    return _feedback_row_to_dict(row) if row else None


def list_feedback(
    *,
    owner_user_id: str | None = None,
    status: str | None = None,
    category: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Return one page of feedback (newest first) plus the unpaginated total.

    ``owner_user_id`` narrows to one reporter's own submissions (the "my
    feedback" view); omit it for the admin triage view, which sees everyone's.
    """
    conn = get_db()
    where: list[str] = []
    params: list[object] = []
    if owner_user_id is not None:
        where.append("owner_user_id = ?")
        params.append(owner_user_id)
    if status is not None:
        where.append("status = ?")
        params.append(status)
    if category is not None:
        where.append("category = ?")
        params.append(category)
    clause = f" WHERE {' AND '.join(where)}" if where else ""

    total = conn.execute(
        f"SELECT COUNT(*) FROM user_feedback{clause}", tuple(params)
    ).fetchone()[0]
    rows = conn.execute(
        f"SELECT * FROM user_feedback{clause} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?",
        (*params, limit, offset),
    ).fetchall()
    return [_feedback_row_to_dict(r) for r in rows], int(total)


def update_feedback(
    feedback_id: str, *, status: str | None = None, admin_note: str | None = None
) -> None:
    """Apply a partial admin update. Fields left as None are untouched, so a
    status change never wipes an existing note (and vice versa)."""
    sets: list[str] = []
    params: list[object] = []
    if status is not None:
        sets.append("status = ?")
        params.append(status)
    if admin_note is not None:
        sets.append("admin_note = ?")
        params.append(admin_note)
    if not sets:
        return
    sets.append("updated_at = datetime('now')")
    conn = get_db()
    conn.execute(
        f"UPDATE user_feedback SET {', '.join(sets)} WHERE id = ?",
        (*params, feedback_id),
    )
    conn.commit()


def feedback_stats() -> dict:
    """Counts for the admin dashboard: one row per status, one per category."""
    conn = get_db()
    status_rows = conn.execute(
        "SELECT status, COUNT(*) AS n FROM user_feedback GROUP BY status"
    ).fetchall()
    by_status = {r["status"]: int(r["n"]) for r in status_rows}
    category_rows = conn.execute(
        "SELECT category, COUNT(*) AS n FROM user_feedback GROUP BY category"
    ).fetchall()
    return {
        "total": sum(by_status.values()),
        "open": by_status.get("open", 0),
        "in_progress": by_status.get("in_progress", 0),
        "resolved": by_status.get("resolved", 0),
        "closed": by_status.get("closed", 0),
        "by_category": {r["category"]: int(r["n"]) for r in category_rows},
    }


def insert_feedback_comment(
    comment_id: str,
    feedback_id: str,
    author_user_id: str,
    body: str,
    is_admin: bool,
) -> dict:
    conn = get_db()
    conn.execute(
        "INSERT INTO user_feedback_comments (id, feedback_id, author_user_id, body, is_admin) "
        "VALUES (?, ?, ?, ?, ?)",
        (comment_id, feedback_id, author_user_id, body, int(is_admin)),
    )
    # A reply is activity on the item, so the triage list re-sorts/refreshes on
    # it rather than showing a stale "last touched" time.
    conn.execute(
        "UPDATE user_feedback SET updated_at = datetime('now') WHERE id = ?",
        (feedback_id,),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM user_feedback_comments WHERE id = ?", (comment_id,)
    ).fetchone()
    return _feedback_comment_row_to_dict(row)


def _feedback_comment_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "feedback_id": row["feedback_id"],
        "author_user_id": row["author_user_id"],
        "body": row["body"],
        "is_admin": bool(row["is_admin"]),
        "created_at": row["created_at"],
    }


def load_feedback_comments(feedback_ids: list[str]) -> dict[str, list[dict]]:
    """Comments for a page of feedback items, keyed by feedback id.

    One query for the whole page instead of one per item; ids come from a
    previous query, never from user input, but are still bound as parameters.
    """
    if not feedback_ids:
        return {}
    conn = get_db()
    placeholders = ", ".join("?" for _ in feedback_ids)
    rows = conn.execute(
        f"SELECT * FROM user_feedback_comments WHERE feedback_id IN ({placeholders}) "
        "ORDER BY created_at ASC, rowid ASC",
        tuple(feedback_ids),
    ).fetchall()
    out: dict[str, list[dict]] = {}
    for row in rows:
        out.setdefault(row["feedback_id"], []).append(_feedback_comment_row_to_dict(row))
    return out


def insert_feedback_attachment(
    attachment_id: str,
    owner_user_id: str,
    filename: str,
    mime_type: str,
    content: bytes,
) -> dict:
    """Store an uploaded screenshot, not yet attached to any feedback item."""
    conn = get_db()
    conn.execute(
        "INSERT INTO user_feedback_attachments "
        "(id, feedback_id, owner_user_id, filename, mime_type, size_bytes, content) "
        "VALUES (?, NULL, ?, ?, ?, ?, ?)",
        (attachment_id, owner_user_id, filename, mime_type, len(content), sqlite3.Binary(content)),
    )
    conn.commit()
    return {
        "id": attachment_id,
        "filename": filename,
        "mime_type": mime_type,
        "size_bytes": len(content),
    }


def get_feedback_attachment(attachment_id: str) -> dict | None:
    """One attachment INCLUDING its bytes -- only the serving endpoint wants
    this; list views use load_feedback_attachments (metadata only)."""
    conn = get_db()
    row = conn.execute(
        "SELECT id, feedback_id, owner_user_id, filename, mime_type, size_bytes, content "
        "FROM user_feedback_attachments WHERE id = ?",
        (attachment_id,),
    ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "feedback_id": row["feedback_id"],
        "owner_user_id": row["owner_user_id"],
        "filename": row["filename"],
        "mime_type": row["mime_type"],
        "size_bytes": int(row["size_bytes"]),
        "content": bytes(row["content"]),
    }


def load_feedback_attachments(feedback_ids: list[str]) -> dict[str, list[dict]]:
    """Attachment METADATA for a page of feedback items, keyed by feedback id.

    Deliberately never selects ``content``: a list of 20 items with 4
    screenshots each would otherwise pull ~160 MB of BLOBs through the
    response path to render thumbnails the client fetches individually.
    """
    if not feedback_ids:
        return {}
    conn = get_db()
    placeholders = ", ".join("?" for _ in feedback_ids)
    rows = conn.execute(
        "SELECT id, feedback_id, filename, mime_type, size_bytes FROM user_feedback_attachments "
        f"WHERE feedback_id IN ({placeholders}) ORDER BY created_at ASC, rowid ASC",
        tuple(feedback_ids),
    ).fetchall()
    out: dict[str, list[dict]] = {}
    for row in rows:
        out.setdefault(row["feedback_id"], []).append(
            {
                "id": row["id"],
                "filename": row["filename"],
                "mime_type": row["mime_type"],
                "size_bytes": int(row["size_bytes"]),
            }
        )
    return out


def claim_feedback_attachments(
    feedback_id: str, attachment_ids: list[str], owner_user_id: str
) -> list[dict]:
    """Bind previously uploaded, still-unattached screenshots to a submitted
    feedback item, and return the ones actually claimed.

    Only rows that are owned by the submitter AND not already attached are
    taken, so a caller cannot graft someone else's screenshot -- or re-use one
    already filed under another report -- onto their own.
    """
    if not attachment_ids:
        return []
    conn = get_db()
    placeholders = ", ".join("?" for _ in attachment_ids)
    conn.execute(
        f"UPDATE user_feedback_attachments SET feedback_id = ? "
        f"WHERE id IN ({placeholders}) AND owner_user_id = ? AND feedback_id IS NULL",
        (feedback_id, *attachment_ids, owner_user_id),
    )
    conn.commit()
    return load_feedback_attachments([feedback_id]).get(feedback_id, [])


def cleanup_orphan_feedback_attachments(hours: int = 24) -> int:
    """Drop screenshots uploaded for a report that was never submitted.

    The widget uploads while the reporter is still typing, so an abandoned
    dialog leaves rows with feedback_id IS NULL that nothing will ever
    reference. Returns the number of rows deleted.
    """
    conn = get_db()
    cur = conn.execute(
        "DELETE FROM user_feedback_attachments WHERE feedback_id IS NULL "
        "AND created_at < datetime('now', ?)",
        (f"-{int(hours)} hours",),
    )
    conn.commit()
    return cur.rowcount or 0


def user_display_names(user_ids: list[str]) -> dict[str, str]:
    """Map user ids -> a human label (display_name, else username).

    Used so a feedback list can name reporters and commenters without the
    caller hitting the users table once per row.
    """
    ids = [uid for uid in dict.fromkeys(user_ids) if uid]
    if not ids:
        return {}
    conn = get_db()
    placeholders = ", ".join("?" for _ in ids)
    rows = conn.execute(
        f"SELECT id, username, display_name FROM users WHERE id IN ({placeholders})",
        tuple(ids),
    ).fetchall()
    return {r["id"]: (r["display_name"] or r["username"]) for r in rows}
