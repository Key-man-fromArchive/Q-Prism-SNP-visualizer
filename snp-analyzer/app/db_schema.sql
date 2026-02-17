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
    metadata_json TEXT
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
