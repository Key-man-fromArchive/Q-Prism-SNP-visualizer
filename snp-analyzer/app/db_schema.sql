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
    -- P22 (C5): which cluster_auto/cluster_threshold revision produced this
    -- row (see app.processing.clustering.CLUSTERING_ALGORITHM_VERSION).
    -- NULL for rows written before this column existed -- there is no
    -- knowable version to back-fill.
    algorithm_version TEXT,
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
    -- Optional link to a durable marker_catalog entry (see below) this
    -- session marker was attached to. Nullable: most markers never link.
    catalog_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, marker_id),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

-- Marker (assay) CATALOG: a durable, user-scoped, plate-independent assay
-- registry. Register an assay ONCE (e.g. "qSwet5.3") with rich detail
-- (genomic target, chemistry, calibration/validation evidence) and reuse it
-- across many plates/sessions by linking a session's marker_regions row to
-- one of these via marker_regions.catalog_id. Scope is the owning user only
-- (TokenData has no team/org concept) -- sharing is an explicit copy
-- (POST /api/marker-catalog/{id}/copy), mirroring saved_layouts.
CREATE TABLE IF NOT EXISTS marker_catalog (
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

-- ---------------------------------------------------------------------------
-- Raw uploaded file retention (P32).
--
-- Upload has always kept only the PARSED readings (well_cycle_data etc.) and
-- discarded the original instrument file. This table is the durable record
-- of one session's original bytes on disk (under app.services
-- .raw_file_storage's per-session directory, itself inside the same
-- volume/parent directory as this SQLite file so both persist together).
--
-- A session row can have NO matching row here for two entirely different
-- reasons that a user must be able to tell apart: it predates this feature
-- (deleted_at is meaningless because it was never written), or its file
-- already expired and was swept (deleted_at/delete_reason set below). See
-- app.services.raw_file_storage.get_raw_file_status for the three-way
-- distinction (none / expired / missing-anomaly) surfaced to the API.
--
-- ON DELETE CASCADE removes this ROW when its session is deleted, but NOT
-- the file on disk -- app.routers.sample._delete_sessions_impl calls
-- raw_file_storage.delete_raw_files_for_sessions() for that.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_raw_files (
    session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    -- Path relative to raw_file_storage's storage root, NOT an absolute path
    -- -- keeps the DB portable if RAW_FILE_DIR is ever relocated.
    stored_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    stored_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    deleted_at TEXT,
    delete_reason TEXT
);

-- ---------------------------------------------------------------------------
-- In-app user feedback (bug reports / feature requests / questions).
--
-- Scope: like saved_layouts and marker_catalog, a feedback item is owned by
-- exactly ONE user (app.auth.TokenData carries only user_id/username/role --
-- there is no team/org concept). Unlike those two, feedback is NOT private to
-- its owner: an admin reads and triages every item, so the owner-only rule
-- here is "who may submit and comment", not "who may read".
--
-- Feedback deliberately does NOT reference sessions(session_id). A report
-- about a plate must outlive that plate: sessions are purged on a retention
-- timer (SESSION_RETENTION_DAYS) and an ON DELETE CASCADE would silently
-- take the bug report with them. The session id is kept inside context_json
-- as a plain string breadcrumb instead.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_feedback (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('bug', 'feature', 'improvement', 'question', 'other')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    -- Where the reporter was when they hit it: active tab, open session,
    -- instrument, viewport, app language. Never sample names or well data
    -- (see frontend/src/lib/feedback-context.ts).
    context_json TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    admin_note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_owner ON user_feedback (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_status ON user_feedback (status);

-- Conversation thread on one feedback item. is_admin is captured at WRITE
-- time rather than joined from users.role: a reply must keep reading as the
-- staff answer it was even if that account is later demoted or deleted.
CREATE TABLE IF NOT EXISTS user_feedback_comments (
    id TEXT PRIMARY KEY,
    feedback_id TEXT NOT NULL REFERENCES user_feedback(id) ON DELETE CASCADE,
    author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_comments_feedback ON user_feedback_comments (feedback_id);

-- Screenshot attachments, stored as BLOBs in this DB rather than on disk.
-- There is no general-purpose file store in this app (app/routers/upload.py
-- streams instrument files straight into memory and never persists them), and
-- the SQLite file is the one artefact already covered by the deployment's
-- volume, so a bounded BLOB (<= 2 MB x 4 per item, validated image types only)
-- keeps a report and its evidence in a single backup unit.
--
-- feedback_id is nullable BY DESIGN: the widget uploads a screenshot while the
-- report is still being typed, so the row exists before there is a feedback id
-- to attach it to. Orphans (never submitted) are swept by
-- cleanup_orphan_feedback_attachments().
CREATE TABLE IF NOT EXISTS user_feedback_attachments (
    id TEXT PRIMARY KEY,
    feedback_id TEXT REFERENCES user_feedback(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    content BLOB NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_attachments_feedback ON user_feedback_attachments (feedback_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_attachments_owner ON user_feedback_attachments (owner_user_id);
