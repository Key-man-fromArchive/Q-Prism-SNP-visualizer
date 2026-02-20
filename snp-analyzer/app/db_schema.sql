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
