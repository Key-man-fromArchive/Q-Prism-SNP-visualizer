-- Schema version tracking for migrations
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    hashed_password TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    instrument TEXT NOT NULL,
    num_wells INTEGER NOT NULL,
    num_cycles INTEGER NOT NULL,
    plate_size INTEGER DEFAULT 96,
    allele2_dye TEXT NOT NULL,
    has_rox INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    raw_filename TEXT,
    metadata_json TEXT,
    user_id TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS well_cycle_data (
    session_id TEXT NOT NULL,
    well TEXT NOT NULL,
    cycle INTEGER NOT NULL,
    fam REAL NOT NULL,
    allele2 REAL NOT NULL,
    rox REAL,
    PRIMARY KEY (session_id, well, cycle),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clustering_results (
    session_id TEXT PRIMARY KEY,
    labels_json TEXT NOT NULL,
    method TEXT NOT NULL,
    cycle INTEGER NOT NULL,
    confidences_json TEXT,
    result_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS manual_welltypes (
    session_id TEXT NOT NULL,
    well TEXT NOT NULL,
    welltype TEXT NOT NULL,
    PRIMARY KEY (session_id, well),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sample_name_overrides (
    session_id TEXT NOT NULL,
    well TEXT NOT NULL,
    sample_name TEXT NOT NULL,
    PRIMARY KEY (session_id, well),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS protocol_overrides (
    session_id TEXT PRIMARY KEY,
    protocol_json TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

-- Manual well groups (user-created groups)
CREATE TABLE IF NOT EXISTS well_groups (
    session_id TEXT NOT NULL,
    group_name TEXT NOT NULL,
    wells_json TEXT NOT NULL,
    PRIMARY KEY (session_id, group_name),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

-- Marker (assay) definitions: first-class resource, source of truth for a
-- session's marker set. Owns wells/ploidy/color/threshold_config/name only --
-- well_type and sample_id stay in manual_welltypes / sample_name_overrides
-- (keyed per-well) and are NOT duplicated here.
CREATE TABLE IF NOT EXISTS marker_regions (
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
);

-- Saved plate layouts: per-user reusable PHYSICAL plate designs (marker set
-- + optional well-types/sample ids), captured from one session's current
-- marker set and re-applicable to another. Scope is the owning user only --
-- TokenData carries only user_id/username/role, there is no team/org
-- concept, so "sharing" a layout is an explicit copy (POST .../copy), not a
-- join to a shared scope.
CREATE TABLE IF NOT EXISTS saved_layouts (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Projects table (replaces projects.json)
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
);

-- Project-session membership
CREATE TABLE IF NOT EXISTS project_sessions (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, session_id)
);
