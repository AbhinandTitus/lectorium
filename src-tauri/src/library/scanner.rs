//! Background library scan.
//!
//! Pipeline per root:
//!   1. walk the tree, classify supported extensions
//!   2. triage against the DB by (path, quick fingerprint) — unchanged files cost nothing
//!   3. new/changed files: extract metadata + cover, upsert
//!   4. lazy pass: BLAKE3 content hashes for rows missing one; hash matches
//!      relink moved files (annotations and progress survive) and skip
//!      true duplicates whose content already exists on disk elsewhere
//!
//! Originals are never modified, moved, or deleted. Missing files keep all
//! user data and are marked `missing_since` only.

use crate::db::Db;
use crate::library::{classify, epub_meta};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "phase"
)]
pub enum ScanEvent {
    Started {
        root_id: i64,
    },
    Progress {
        root_id: i64,
        found: u64,
        processed: u64,
    },
    Done {
        root_id: i64,
        found: u64,
        added: u64,
        relinked: u64,
        missing: u64,
    },
    Failed {
        root_id: i64,
        message: String,
    },
}

fn emit(app: &AppHandle, ev: &ScanEvent) {
    let _ = app.emit("library:scan", ev);
}

/// Outcome of one root scan (also the payload of the Done event).
#[derive(Debug, Default, Clone, Copy)]
pub struct ScanOutcome {
    pub found: u64,
    pub added: u64,
    pub relinked: u64,
    pub missing: u64,
}

/// Spawn a full scan of one root on a background thread.
pub fn spawn_scan(app: AppHandle, root_id: i64, root_path: PathBuf) {
    std::thread::spawn(move || {
        emit(&app, &ScanEvent::Started { root_id });
        let covers_dir = app
            .path()
            .app_cache_dir()
            .map(|d| d.join("covers"))
            .unwrap_or_else(|_| std::env::temp_dir().join("lectorium-covers"));
        let db = app.state::<Db>();
        let mut on_progress = |found: u64, processed: u64| {
            emit(
                &app,
                &ScanEvent::Progress {
                    root_id,
                    found,
                    processed,
                },
            );
        };
        match run_scan(&db, &covers_dir, root_id, &root_path, &mut on_progress) {
            Ok(o) => emit(
                &app,
                &ScanEvent::Done {
                    root_id,
                    found: o.found,
                    added: o.added,
                    relinked: o.relinked,
                    missing: o.missing,
                },
            ),
            Err(e) => {
                tracing::error!(?e, root_id, "scan failed");
                emit(
                    &app,
                    &ScanEvent::Failed {
                        root_id,
                        message: "Lectorium could not finish scanning this folder.".into(),
                    },
                );
            }
        }
    });
}

/// Testable scan core: no Tauri types, progress via callback.
pub fn run_scan(
    db: &Db,
    covers_dir: &Path,
    root_id: i64,
    root: &Path,
    on_progress: &mut dyn FnMut(u64, u64),
) -> Result<ScanOutcome, crate::error::AppError> {
    std::fs::create_dir_all(covers_dir)?;

    // Pass 1: walk + collect candidates (cheap; no file reads yet).
    let mut candidates: Vec<(PathBuf, String, String)> = Vec::new(); // (path, source, reading)
    for entry in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let Some(ext) = entry.path().extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if let Some((source, reading)) = classify(ext) {
            candidates.push((entry.into_path(), source.into(), reading.into()));
        }
    }
    let found = candidates.len() as u64;

    let mut added = 0u64;
    let mut processed = 0u64;

    // Pass 2: triage + upsert. Short transactions keep the UI responsive.
    for (path, source_format, reading_format) in &candidates {
        processed += 1;
        if processed.is_multiple_of(50) {
            on_progress(found, processed);
        }

        let Ok(md) = std::fs::metadata(path) else {
            continue;
        };
        let fingerprint = quick_fingerprint(&md);
        let path_str = path.to_string_lossy().to_string();

        {
            let conn = db.conn.lock().expect("db lock");
            let existing: Option<(String, Option<String>)> = conn
                .query_row(
                    "SELECT id, quick_fingerprint FROM books WHERE canonical_path = ?1",
                    [&path_str],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok();

            match existing {
                Some((id, Some(fp))) if fp == fingerprint => {
                    // Unchanged; clear a stale missing flag if the file is back.
                    conn.execute(
                        "UPDATE books SET missing_since = NULL WHERE id = ?1 AND missing_since IS NOT NULL",
                        [&id],
                    )?;
                    continue;
                }
                Some((id, _)) => {
                    // Same path, changed content: refresh fingerprint, invalidate hash.
                    conn.execute(
                        "UPDATE books SET quick_fingerprint = ?2, content_hash = NULL,
                                          missing_since = NULL WHERE id = ?1",
                        rusqlite::params![id, fingerprint],
                    )?;
                    continue;
                }
                None => {}
            }
        }

        // New path → extract metadata outside the DB lock.
        let id = Uuid::new_v4().to_string();
        let (title, authors, language, description, cover_path) =
            extract_metadata(path, source_format, &id, covers_dir);

        let conn = db.conn.lock().expect("db lock");
        conn.execute(
            "INSERT INTO books (id, quick_fingerprint, canonical_path, source_format,
                                reading_format, title, authors, language, description, cover_cache_path)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            rusqlite::params![
                id,
                fingerprint,
                path_str,
                source_format,
                reading_format,
                title,
                serde_json::to_string(&authors).unwrap_or_else(|_| "[]".into()),
                language,
                description,
                cover_path.map(|p| p.to_string_lossy().to_string()),
            ],
        )?;
        added += 1;
    }

    // Pass 3: mark books under this root whose files vanished.
    let mut missing = 0u64;
    {
        let conn = db.conn.lock().expect("db lock");
        let root_like = format!("{}%", root.to_string_lossy());
        let mut stmt = conn.prepare(
            "SELECT id, canonical_path FROM books
             WHERE canonical_path LIKE ?1 AND missing_since IS NULL",
        )?;
        let rows: Vec<(String, String)> = stmt
            .query_map([&root_like], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        for (id, p) in rows {
            if !Path::new(&p).exists() {
                conn.execute(
                    "UPDATE books SET missing_since = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
                    [&id],
                )?;
                missing += 1;
            }
        }
        conn.execute(
            "UPDATE library_roots SET last_scan_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
            [root_id],
        )?;
    }

    // Pass 4: lazy hashing + move-relink + duplicate suppression.
    let relinked = hash_pass(db)?;

    Ok(ScanOutcome {
        found,
        added,
        relinked,
        missing,
    })
}

/// Hash rows lacking a content hash; use matches to relink moved files.
fn hash_pass(db: &Db) -> Result<u64, crate::error::AppError> {
    let pending: Vec<(String, String)> = {
        let conn = db.conn.lock().expect("db lock");
        let mut stmt = conn.prepare(
            "SELECT id, canonical_path FROM books
             WHERE content_hash IS NULL AND missing_since IS NULL",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    let mut relinked = 0u64;
    for (id, path) in pending {
        let Ok(hash) = hash_file(Path::new(&path)) else {
            continue;
        };
        let conn = db.conn.lock().expect("db lock");

        // A missing book with identical content = the same file, moved.
        // The old row keeps its annotations; the new row (this one) is the
        // duplicate if it was just added by the scan.
        let moved: Option<String> = conn
            .query_row(
                "SELECT id FROM books WHERE content_hash = ?1 AND missing_since IS NOT NULL AND id != ?2",
                rusqlite::params![hash, id],
                |r| r.get(0),
            )
            .ok();

        if let Some(old_id) = moved {
            let fresh_row_has_no_user_data: bool = conn
                .query_row(
                    "SELECT NOT EXISTS(SELECT 1 FROM annotations WHERE book_id = ?1)
                        AND NOT EXISTS(SELECT 1 FROM book_locations WHERE book_id = ?1)",
                    [&id],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if fresh_row_has_no_user_data {
                conn.execute(
                    "UPDATE books SET canonical_path = (SELECT canonical_path FROM books WHERE id = ?2),
                                      quick_fingerprint = (SELECT quick_fingerprint FROM books WHERE id = ?2),
                                      content_hash = ?3, missing_since = NULL
                     WHERE id = ?1",
                    rusqlite::params![old_id, id, hash],
                )?;
                conn.execute("DELETE FROM books WHERE id = ?1", [&id])?;
                tracing::info!(old = old_id, new = id, "relinked moved book");
                relinked += 1;
                continue;
            }
        }

        conn.execute(
            "UPDATE books SET content_hash = ?2 WHERE id = ?1",
            rusqlite::params![id, hash],
        )?;
    }
    Ok(relinked)
}

fn extract_metadata(
    path: &Path,
    source_format: &str,
    book_id: &str,
    covers_dir: &Path,
) -> (
    String,
    Vec<String>,
    Option<String>,
    Option<String>,
    Option<PathBuf>,
) {
    let fallback_title = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".into());

    if source_format == "epub" {
        if let Some(meta) = epub_meta::read_epub_meta(path) {
            let cover_path = meta.cover.and_then(|(bytes, ext)| {
                let p = covers_dir.join(format!("{book_id}.{ext}"));
                std::fs::write(&p, bytes).ok().map(|_| p)
            });
            return (
                meta.title.unwrap_or(fallback_title),
                meta.authors,
                meta.language,
                meta.description,
                cover_path,
            );
        }
    }
    // PDFs and plain text: title from filename for now; the frontend can
    // improve PDF metadata after first open (PDF.js getMetadata).
    (fallback_title, Vec::new(), None, None, None)
}

fn quick_fingerprint(md: &std::fs::Metadata) -> String {
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}:{}", md.len(), mtime)
}

fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut hasher = blake3::Hasher::new();
    let mut file = std::fs::File::open(path)?;
    std::io::copy(&mut file, &mut hasher)?;
    Ok(hasher.finalize().to_hex().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    struct Env {
        db: Db,
        root: PathBuf,
        covers: PathBuf,
        base: PathBuf,
    }

    fn setup(name: &str) -> Env {
        let base =
            std::env::temp_dir().join(format!("lectorium-scan-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("library");
        let covers = base.join("covers");
        std::fs::create_dir_all(&root).unwrap();
        let db = db::open(&base.join("data")).unwrap();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO library_roots (id, canonical_path, display_name) VALUES (1, ?1, 'test')",
                [root.to_string_lossy().to_string()],
            )
            .unwrap();
        }
        Env {
            db,
            root,
            covers,
            base,
        }
    }

    fn scan(env: &Env) -> ScanOutcome {
        run_scan(&env.db, &env.covers, 1, &env.root, &mut |_, _| {}).unwrap()
    }

    fn fixture(rel: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("fixtures")
            .join(rel)
    }

    #[test]
    fn scan_adds_books_and_rescan_is_idempotent() {
        let env = setup("add");
        std::fs::write(env.root.join("one.txt"), "First book contents.").unwrap();
        std::fs::create_dir_all(env.root.join("nested")).unwrap();
        std::fs::write(env.root.join("nested").join("two.md"), "# Second\n\nbody").unwrap();
        std::fs::write(env.root.join("ignore.xyz"), "not a book").unwrap();

        let first = scan(&env);
        assert_eq!(first.found, 2);
        assert_eq!(first.added, 2);

        let second = scan(&env);
        assert_eq!(second.added, 0, "rescan must not duplicate");

        let conn = env.db.conn.lock().unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM books", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
        let hashed: i64 = conn
            .query_row(
                "SELECT count(*) FROM books WHERE content_hash IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hashed, 2, "lazy hash pass fills all hashes");
        drop(conn);
        let _ = std::fs::remove_dir_all(env.base);
    }

    #[test]
    fn epub_metadata_and_cover_are_extracted() {
        let epub = fixture("epub/english-novel.epub");
        if !epub.exists() {
            panic!("fixtures not built — run `node fixtures/scripts/build-fixtures.mjs`");
        }
        let env = setup("epubmeta");
        std::fs::copy(&epub, env.root.join("novel.epub")).unwrap();

        let outcome = scan(&env);
        assert_eq!(outcome.added, 1);
        let conn = env.db.conn.lock().unwrap();
        let (title, authors, language): (String, String, Option<String>) = conn
            .query_row("SELECT title, authors, language FROM books", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(title, "The Quiet Method");
        assert!(authors.contains("Lectorium Fixtures"));
        assert_eq!(language.as_deref(), Some("en"));
        drop(conn);
        let _ = std::fs::remove_dir_all(env.base);
    }

    #[test]
    fn malayalam_epub_title_survives_unicode_roundtrip() {
        let epub = fixture("epub/malayalam.epub");
        if !epub.exists() {
            panic!("fixtures not built — run `node fixtures/scripts/build-fixtures.mjs`");
        }
        let env = setup("ml");
        std::fs::copy(&epub, env.root.join("ml.epub")).unwrap();
        scan(&env);
        let conn = env.db.conn.lock().unwrap();
        let title: String = conn
            .query_row("SELECT title FROM books", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            title, "ശാന്തമായ രീതി",
            "Malayalam title must survive extraction untouched"
        );
        drop(conn);
        let _ = std::fs::remove_dir_all(env.base);
    }

    #[test]
    fn moved_file_is_relinked_and_keeps_reading_position() {
        let env = setup("move");
        let old_path = env.root.join("keep.txt");
        std::fs::write(&old_path, "A book that will move somewhere else.").unwrap();
        scan(&env);

        // reader progress exists for the book
        let book_id: String = {
            let conn = env.db.conn.lock().unwrap();
            let id: String = conn
                .query_row("SELECT id FROM books", [], |r| r.get(0))
                .unwrap();
            conn.execute(
                "INSERT INTO book_locations (book_id, engine_type, locator_json) VALUES (?1,'text','{\"v\":1}')",
                [&id],
            )
            .unwrap();
            id
        };

        // move the file within the root
        std::fs::create_dir_all(env.root.join("moved")).unwrap();
        std::fs::rename(&old_path, env.root.join("moved").join("keep.txt")).unwrap();

        let outcome = scan(&env);
        assert_eq!(outcome.relinked, 1, "hash match must relink, not duplicate");

        let conn = env.db.conn.lock().unwrap();
        let (id, path, missing): (String, String, Option<String>) = conn
            .query_row(
                "SELECT id, canonical_path, missing_since FROM books",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(id, book_id, "the original row (with user data) survives");
        assert!(path.contains("moved"), "path updated to the new location");
        assert!(missing.is_none());
        let loc_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM book_locations WHERE book_id = ?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(loc_count, 1, "reading position survives the move");
        drop(conn);
        let _ = std::fs::remove_dir_all(env.base);
    }

    #[test]
    fn vanished_file_is_marked_missing_and_loses_nothing() {
        let env = setup("missing");
        let path = env.root.join("gone.txt");
        std::fs::write(&path, "This book will disappear.").unwrap();
        scan(&env);
        {
            let conn = env.db.conn.lock().unwrap();
            let id: String = conn
                .query_row("SELECT id FROM books", [], |r| r.get(0))
                .unwrap();
            conn.execute(
                "INSERT INTO book_locations (book_id, engine_type, locator_json) VALUES (?1,'text','{}')",
                [&id],
            )
            .unwrap();
        }
        std::fs::remove_file(&path).unwrap();

        let outcome = scan(&env);
        assert_eq!(outcome.missing, 1);
        let conn = env.db.conn.lock().unwrap();
        let (missing_since, locs): (Option<String>, i64) = conn
            .query_row(
                "SELECT b.missing_since,
                        (SELECT count(*) FROM book_locations l WHERE l.book_id = b.id)
                 FROM books b",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(missing_since.is_some(), "marked missing, not deleted");
        assert_eq!(locs, 1, "user data retained indefinitely");
        drop(conn);
        let _ = std::fs::remove_dir_all(env.base);
    }
}
