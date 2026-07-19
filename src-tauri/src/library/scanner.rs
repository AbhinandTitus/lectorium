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

use crate::db::{repo, Db};
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

        let changed_id = {
            let conn = db.conn.lock().expect("db lock");
            let existing = repo::scan_existing_by_path(&conn, &path_str)?;

            match existing {
                Some((id, Some(fp))) if fp == fingerprint => {
                    // Unchanged; clear a stale missing flag if the file is back.
                    repo::scan_clear_missing(&conn, &id)?;
                    continue;
                }
                Some((id, _)) => {
                    // Metadata is refreshed below, outside the DB lock.
                    Some(id)
                }
                None => None,
            }
        };

        if let Some(id) = changed_id {
            let (title, authors, language, description, cover_path) =
                extract_metadata(path, source_format, &id, covers_dir);
            let authors_json = serde_json::to_string(&authors).unwrap_or_else(|_| "[]".into());
            let cover_path = cover_path.map(|p| p.to_string_lossy().to_string());
            let conn = db.conn.lock().expect("db lock");
            repo::scan_update_changed(
                &conn,
                &repo::ScannedBook {
                    id: &id,
                    fingerprint: &fingerprint,
                    canonical_path: &path_str,
                    source_format,
                    reading_format,
                    title: &title,
                    authors_json: &authors_json,
                    language: language.as_deref(),
                    description: description.as_deref(),
                    cover_cache_path: cover_path.as_deref(),
                },
            )?;
            continue;
        }

        // New path → extract metadata outside the DB lock.
        let id = Uuid::new_v4().to_string();
        let (title, authors, language, description, cover_path) =
            extract_metadata(path, source_format, &id, covers_dir);
        let authors_json = serde_json::to_string(&authors).unwrap_or_else(|_| "[]".into());
        let cover_path = cover_path.map(|p| p.to_string_lossy().to_string());

        let conn = db.conn.lock().expect("db lock");
        let inserted = repo::scan_insert(
            &conn,
            &repo::ScannedBook {
                id: &id,
                fingerprint: &fingerprint,
                canonical_path: &path_str,
                source_format,
                reading_format,
                title: &title,
                authors_json: &authors_json,
                language: language.as_deref(),
                description: description.as_deref(),
                cover_cache_path: cover_path.as_deref(),
            },
        )?;
        added += u64::from(inserted);
    }

    // Pass 3: mark books under this root whose files vanished.
    let mut missing = 0u64;
    {
        let conn = db.conn.lock().expect("db lock");
        let rows = repo::scan_present_paths(&conn)?;
        for (id, p) in rows {
            let path = Path::new(&p);
            if path.starts_with(root) && !path.exists() {
                repo::scan_mark_missing(&conn, &id)?;
                missing += 1;
            }
        }
        repo::scan_mark_root_complete(&conn, root_id)?;
    }

    // Pass 4: lazy hashing + move-relink + duplicate suppression.
    let (relinked, duplicates) = hash_pass(db)?;
    added = added.saturating_sub(duplicates);

    Ok(ScanOutcome {
        found,
        added,
        relinked,
        missing,
    })
}

/// Hash rows lacking a content hash; use matches to relink moved files.
fn hash_pass(db: &Db) -> Result<(u64, u64), crate::error::AppError> {
    let pending = {
        let conn = db.conn.lock().expect("db lock");
        repo::scan_hash_pending(&conn)?
    };

    let mut relinked = 0u64;
    let mut duplicates = 0u64;
    for (id, path) in pending {
        let Ok(hash) = hash_file(Path::new(&path)) else {
            continue;
        };
        let conn = db.conn.lock().expect("db lock");

        // A missing book with identical content = the same file, moved.
        // The old row keeps its annotations; the new row (this one) is the
        // duplicate if it was just added by the scan.
        let moved = repo::scan_missing_with_hash(&conn, &hash, &id)?;

        if let Some(old_id) = moved {
            let fresh_row_has_no_user_data = repo::scan_book_has_no_user_data(&conn, &id)?;
            if fresh_row_has_no_user_data {
                repo::scan_relink_moved(&conn, &old_id, &id, &hash)?;
                tracing::info!(old = old_id, new = id, "relinked moved book");
                relinked += 1;
                continue;
            }
        }

        // Two live paths with identical bytes represent one publication in
        // Stacks. Keep the earlier row and discard only a fresh row that has
        // no reading data attached to it.
        let duplicate_live = repo::scan_live_with_hash(&conn, &hash, &id)?;
        if duplicate_live.is_some() {
            let has_no_user_data = repo::scan_book_has_no_user_data(&conn, &id)?;
            if has_no_user_data {
                repo::scan_delete_book(&conn, &id)?;
                duplicates += 1;
                continue;
            }
        }

        repo::scan_set_hash(&conn, &id, &hash)?;
    }
    Ok((relinked, duplicates))
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

pub(crate) fn quick_fingerprint(md: &std::fs::Metadata) -> String {
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}:{}", md.len(), mtime)
}

pub(crate) fn hash_file(path: &Path) -> std::io::Result<String> {
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
            repo::add_root(&conn, &root.to_string_lossy(), "test").unwrap();
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
        let count = repo::count_books(&conn).unwrap();
        assert_eq!(count, 2);
        let hashed = repo::scan_hashed_count(&conn).unwrap();
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
        let book = repo::list_books(&conn, &repo::BookQuery::default())
            .unwrap()
            .remove(0);
        assert_eq!(book.title, "The Quiet Method");
        assert!(book
            .authors
            .iter()
            .any(|author| author == "Lectorium Fixtures"));
        assert_eq!(book.language.as_deref(), Some("en"));
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
        let title = repo::list_books(&conn, &repo::BookQuery::default()).unwrap()[0]
            .title
            .clone();
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
            let id = repo::list_books(&conn, &repo::BookQuery::default()).unwrap()[0]
                .id
                .clone();
            repo::save_location(
                &conn,
                &id,
                &repo::SavedLocation {
                    engine_type: "text".into(),
                    locator_json: "{\"v\":1,\"engine\":\"text\",\"primary\":{\"blockIndex\":0,\"charOffset\":0},\"textQuote\":null,\"coarse\":{\"sectionTitle\":null,\"blockIndex\":0}}".into(),
                    section_title: None,
                    page_index: None,
                    updated_at: None,
                },
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
        let book = repo::list_books(&conn, &repo::BookQuery::default())
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        assert_eq!(
            book.id, book_id,
            "the original row (with user data) survives"
        );
        assert!(
            book.canonical_path.contains("moved"),
            "path updated to the new location"
        );
        assert!(!book.missing);
        assert!(
            repo::get_book(&conn, &book.id).unwrap().location.is_some(),
            "reading position survives the move"
        );
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
            let id = repo::list_books(&conn, &repo::BookQuery::default()).unwrap()[0]
                .id
                .clone();
            repo::save_location(
                &conn,
                &id,
                &repo::SavedLocation {
                    engine_type: "text".into(),
                    locator_json: "{\"v\":1,\"engine\":\"text\",\"primary\":{\"blockIndex\":0,\"charOffset\":0},\"textQuote\":null,\"coarse\":{\"sectionTitle\":null,\"blockIndex\":0}}".into(),
                    section_title: None,
                    page_index: None,
                    updated_at: None,
                },
            )
            .unwrap();
        }
        std::fs::remove_file(&path).unwrap();

        let outcome = scan(&env);
        assert_eq!(outcome.missing, 1);
        let conn = env.db.conn.lock().unwrap();
        let book = repo::list_books(&conn, &repo::BookQuery::default())
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        assert!(book.missing, "marked missing, not deleted");
        assert!(
            repo::get_book(&conn, &book.id).unwrap().location.is_some(),
            "user data retained indefinitely"
        );
        drop(conn);
        let _ = std::fs::remove_dir_all(env.base);
    }

    #[test]
    fn identical_live_files_are_one_library_entry() {
        let env = setup("duplicate");
        let bytes = "The same publication bytes.";
        std::fs::write(env.root.join("copy-one.txt"), bytes).unwrap();
        std::fs::write(env.root.join("copy-two.txt"), bytes).unwrap();

        let outcome = scan(&env);
        assert_eq!(outcome.added, 1);
        let conn = env.db.conn.lock().unwrap();
        let count = repo::count_books(&conn).unwrap();
        assert_eq!(count, 1);
        drop(conn);
        let _ = std::fs::remove_dir_all(env.base);
    }

    #[test]
    fn missing_detection_uses_path_components_not_string_prefixes() {
        let env = setup("root-prefix");
        let sibling = env.base.join("library-other").join("outside.txt");
        {
            let conn = env.db.conn.lock().unwrap();
            let path = sibling.to_string_lossy().to_string();
            repo::scan_insert(
                &conn,
                &repo::ScannedBook {
                    id: "outside",
                    fingerprint: "0:0",
                    canonical_path: &path,
                    source_format: "txt",
                    reading_format: "text",
                    title: "Outside",
                    authors_json: "[]",
                    language: None,
                    description: None,
                    cover_cache_path: None,
                },
            )
            .unwrap();
        }

        scan(&env);
        let conn = env.db.conn.lock().unwrap();
        assert!(!repo::get_book(&conn, "outside").unwrap().summary.missing);
        drop(conn);
        let _ = std::fs::remove_dir_all(env.base);
    }

    #[test]
    fn mobi_is_not_mislabeled_as_epub() {
        let env = setup("mobi");
        std::fs::write(env.root.join("legacy.mobi"), "not an epub container").unwrap();
        let outcome = scan(&env);
        assert_eq!(outcome.found, 0);
        assert_eq!(outcome.added, 0);
        let _ = std::fs::remove_dir_all(env.base);
    }
}
