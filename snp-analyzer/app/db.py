"""SQLite write-through cache for session persistence."""
import json
import sqlite3
from pathlib import Path

DB_PATH = Path("/app/data/snp_analyzer.db")

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


def init_db():
    conn = get_db()
    schema_path = Path(__file__).parent / "db_schema.sql"
    conn.executescript(schema_path.read_text())
    conn.commit()


def save_session(session_id: str, unified, filename: str = ""):
    """Write session metadata + all well cycle data to DB."""
    conn = get_db()
    metadata = {}
    if unified.sample_names:
        metadata["sample_names"] = unified.sample_names
    if unified.protocol_steps:
        metadata["protocol_steps"] = [s.model_dump() for s in unified.protocol_steps]
    if unified.data_windows:
        metadata["data_windows"] = [w.model_dump() for w in unified.data_windows]

    conn.execute(
        """INSERT OR REPLACE INTO sessions
           (session_id, instrument, num_wells, num_cycles, allele2_dye, has_rox, raw_filename, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (session_id, unified.instrument, len(unified.wells), len(unified.cycles),
         unified.allele2_dye, int(unified.has_rox), filename, json.dumps(metadata)),
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


def save_clustering(session_id: str, result):
    """Write clustering result to DB."""
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO clustering_results (session_id, labels_json, method, cycle) VALUES (?, ?, ?, ?)",
        (session_id, json.dumps(result.assignments), result.algorithm, result.cycle),
    )
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

        data = [WellCycleData(well=r["well"], cycle=r["cycle"], fam=r["fam"], allele2=r["allele2"], rox=r["rox"]) for r in well_rows]
        wells = sorted(set(d.well for d in data))
        cycles = sorted(set(d.cycle for d in data))

        sample_names = metadata.get("sample_names")
        protocol_steps = None
        if "protocol_steps" in metadata:
            protocol_steps = [ProtocolStep(**s) for s in metadata["protocol_steps"]]
        data_windows = None
        if "data_windows" in metadata:
            data_windows = [DataWindow(**w) for w in metadata["data_windows"]]

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
        )

        # Load clustering results
        clustering = None
        cr = conn.execute("SELECT * FROM clustering_results WHERE session_id = ?", (sid,)).fetchone()
        if cr:
            clustering = ClusteringResult(
                algorithm=cr["method"], cycle=cr["cycle"],
                assignments=json.loads(cr["labels_json"]),
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

        sessions_data.append({
            "session_id": sid,
            "unified": unified,
            "clustering": clustering,
            "welltypes": welltypes,
            "sample_overrides": sample_overrides,
            "protocol_override": protocol_override,
        })

    return sessions_data
