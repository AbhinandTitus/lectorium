//! Versioned, forward-only schema migrations.
//!
//! Rules:
//! - Migrations are append-only; never edit a shipped migration.
//! - A rotating backup is taken before any migration runs (see `backup`).
//! - Each migration runs inside a transaction; failure rolls back and the
//!   pre-migration backup remains on disk.

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "initial schema",
    sql: r#"
CREATE TABLE library_roots (
    id INTEGER PRIMARY KEY,
    canonical_path TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_scan_at TEXT,
    watch_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE books (
    id TEXT PRIMARY KEY,                -- UUID
    content_hash TEXT,                  -- BLAKE3 hex; filled lazily in background
    quick_fingerprint TEXT,             -- size:mtime for scan triage
    canonical_path TEXT NOT NULL,
    derived_path TEXT,                  -- e.g. cached EPUB from explicit Calibre conversion
    source_format TEXT NOT NULL,        -- epub | pdf | txt | md | html | mobi | azw3
    reading_format TEXT NOT NULL,       -- epub | pdf | text
    title TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '[]', -- JSON array
    language TEXT,
    series TEXT,
    series_index REAL,
    description TEXT,
    cover_cache_path TEXT,
    status TEXT NOT NULL DEFAULT 'shelf'
        CHECK (status IN ('shelf','desk','paused','completed','reference')),
    desk_role TEXT
        CHECK (desk_role IN ('current','companion','short')),
    reading_mode TEXT NOT NULL DEFAULT 'story'
        CHECK (reading_mode IN ('story','study','contemplative')),
    added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_opened_at TEXT,
    completed_at TEXT,
    missing_since TEXT,
    metadata_override TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_books_status ON books(status);
CREATE INDEX idx_books_hash ON books(content_hash);
CREATE INDEX idx_books_path ON books(canonical_path);
CREATE UNIQUE INDEX idx_books_desk_role
    ON books(desk_role) WHERE desk_role IS NOT NULL;

CREATE TABLE book_locations (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    engine_type TEXT NOT NULL,          -- epub | pdf | text
    locator_json TEXT NOT NULL,         -- envelope, ADR 0004
    section_title TEXT,
    page_index INTEGER,
    hidden_progress_estimate REAL,      -- never shown as a score
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE annotations (
    id TEXT PRIMARY KEY,                -- UUID
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    kind TEXT NOT NULL
        CHECK (kind IN ('highlight','note','bookmark','quote','idea','question',
                        'vocabulary','action','character','free')),
    start_locator_json TEXT NOT NULL,
    end_locator_json TEXT,
    exact_quote TEXT,
    prefix TEXT,
    suffix TEXT,
    note TEXT,
    color_token TEXT,
    commonplace_heading TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_annotations_book ON annotations(book_id);
CREATE INDEX idx_annotations_heading ON annotations(commonplace_heading);

CREATE TABLE vocabulary (
    id TEXT PRIMARY KEY,                -- UUID
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    normalized_word TEXT NOT NULL,
    displayed_word TEXT NOT NULL,
    sentence TEXT NOT NULL,
    definition TEXT,
    locator_json TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_vocabulary_book ON vocabulary(book_id);
CREATE INDEX idx_vocabulary_word ON vocabulary(normalized_word);

CREATE TABLE links (
    from_annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
    to_annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (from_annotation_id, to_annotation_id)
);

CREATE TABLE recall_state (
    item_type TEXT NOT NULL CHECK (item_type IN ('annotation','vocabulary')),
    item_id TEXT NOT NULL,
    available_after TEXT,
    last_seen_at TEXT,
    reader_response TEXT,
    PRIMARY KEY (item_type, item_id)
);

CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL,
    json TEXT NOT NULL
);
"#,
}];
