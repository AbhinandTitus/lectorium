//! The typed IPC surface. Commands stay thin: validate, delegate, return.

use crate::db::repo::{
    self, Annotation, BookDetail, BookQuery, BookSummary, CommonplaceEntry, CommonplaceQuery,
    DeskConflict, LibraryRoot, RecallItem, SavedLocation, VocabularyEntry,
};
use crate::db::{schema_version, Db};
use crate::error::AppError;
use crate::library::scanner;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::MutexGuard;
use tauri::{AppHandle, Manager, State};

fn lock<'a>(db: &'a State<'_, Db>) -> Result<MutexGuard<'a, rusqlite::Connection>, AppError> {
    db.conn
        .lock()
        .map_err(|_| AppError::Other("Lectorium's database is busy. Please try again.".into()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub app_version: String,
    pub db_schema_version: i64,
    pub db_path: String,
    pub book_count: i64,
    pub has_roots: bool,
    /// launched with `--resume` (shortcut / deep-link direct resume)
    pub resume_requested: bool,
    /// book with the most recently updated reading location
    pub last_location_book_id: Option<String>,
}

/// Startup health check: proves IPC and the migrated database both work.
#[tauri::command]
pub fn app_status(db: State<'_, Db>) -> Result<AppStatus, AppError> {
    let conn = lock(&db)?;
    Ok(AppStatus {
        app_version: env!("CARGO_PKG_VERSION").into(),
        db_schema_version: schema_version(&conn)?,
        db_path: db.db_path.to_string_lossy().into_owned(),
        book_count: repo::count_books(&conn)?,
        has_roots: !repo::list_roots(&conn)?.is_empty(),
        resume_requested: std::env::args().any(|a| a == "--resume"),
        last_location_book_id: repo::most_recent_book_id(&conn)?,
    })
}

#[tauri::command]
pub fn list_library_roots(db: State<'_, Db>) -> Result<Vec<LibraryRoot>, AppError> {
    let conn = lock(&db)?;
    repo::list_roots(&conn)
}

/// Register a user-chosen folder and start scanning it in the background.
#[tauri::command]
pub fn add_library_root(
    app: AppHandle,
    db: State<'_, Db>,
    path: String,
) -> Result<LibraryRoot, AppError> {
    let canonical = std::fs::canonicalize(&path)
        .map_err(|_| AppError::Other("That folder could not be opened.".into()))?;
    if !canonical.is_dir() {
        return Err(AppError::Other("That is not a folder.".into()));
    }
    let canonical_str = canonical.to_string_lossy().to_string();
    let display = canonical
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| canonical_str.clone());

    let id = {
        let conn = lock(&db)?;
        repo::add_root(&conn, &canonical_str, &display)?
    };
    scanner::spawn_scan(app, id, canonical);
    Ok(LibraryRoot {
        id,
        canonical_path: canonical_str,
        display_name: display,
        last_scan_at: None,
    })
}

/// Re-scan every granted root in the background.
#[tauri::command]
pub fn rescan_library(app: AppHandle, db: State<'_, Db>) -> Result<(), AppError> {
    let roots = {
        let conn = lock(&db)?;
        repo::list_roots(&conn)?
    };
    for root in roots {
        scanner::spawn_scan(app.clone(), root.id, root.canonical_path.into());
    }
    Ok(())
}

#[tauri::command]
pub fn list_books(db: State<'_, Db>, query: BookQuery) -> Result<Vec<BookSummary>, AppError> {
    let conn = lock(&db)?;
    repo::list_books(&conn, &query)
}

#[tauri::command]
pub fn desk_books(db: State<'_, Db>) -> Result<Vec<BookSummary>, AppError> {
    let conn = lock(&db)?;
    repo::desk_books(&conn)
}

#[tauri::command]
pub fn get_book(db: State<'_, Db>, book_id: String) -> Result<BookDetail, AppError> {
    let conn = lock(&db)?;
    repo::get_book(&conn, &book_id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", untagged)]
pub enum DeskResult {
    Ok { ok: bool },
    Conflict { conflict: DeskConflict },
}

#[tauri::command]
pub fn set_desk_role(
    db: State<'_, Db>,
    book_id: String,
    role: Option<String>,
    replace: Option<bool>,
) -> Result<DeskResult, AppError> {
    let conn = lock(&db)?;
    let conflict = repo::set_desk_role(&conn, &book_id, role.as_deref(), replace.unwrap_or(false))?;
    Ok(match conflict {
        Some(conflict) => DeskResult::Conflict { conflict },
        None => DeskResult::Ok { ok: true },
    })
}

#[tauri::command]
pub fn set_book_status(db: State<'_, Db>, book_id: String, status: String) -> Result<(), AppError> {
    let conn = lock(&db)?;
    repo::set_status(&conn, &book_id, &status)
}

#[tauri::command]
pub fn save_location(
    db: State<'_, Db>,
    book_id: String,
    location: SavedLocation,
) -> Result<(), AppError> {
    let conn = lock(&db)?;
    repo::save_location(&conn, &book_id, &location)
}

#[tauri::command]
pub fn mark_opened(db: State<'_, Db>, book_id: String) -> Result<(), AppError> {
    let conn = lock(&db)?;
    repo::mark_opened(&conn, &book_id)
}

/// Point a missing book at a file the user found again.
#[tauri::command]
pub fn relink_book(db: State<'_, Db>, book_id: String, new_path: String) -> Result<(), AppError> {
    let canonical = std::fs::canonicalize(&new_path)
        .map_err(|_| AppError::Other("That file could not be opened.".into()))?;
    if !canonical.is_file() {
        return Err(AppError::Other("That is not a readable book file.".into()));
    }
    let conn = lock(&db)?;
    let within_root = repo::list_roots(&conn)?
        .iter()
        .any(|root| canonical.starts_with(Path::new(&root.canonical_path)));
    if !within_root {
        return Err(AppError::Other(
            "Choose a file inside one of your library folders.".into(),
        ));
    }
    let identity = repo::relink_identity(&conn, &book_id)?;
    let source_format = canonical
        .extension()
        .and_then(|ext| ext.to_str())
        .and_then(crate::library::classify)
        .map(|(source, _)| source)
        .ok_or_else(|| AppError::Other("That file format cannot be opened by Lectorium.".into()))?;
    if source_format != identity.source_format {
        return Err(AppError::Other(
            "Choose the same file format as the missing book.".into(),
        ));
    }
    let hash = scanner::hash_file(&canonical)
        .map_err(|_| AppError::Other("Lectorium could not verify that file.".into()))?;
    if identity
        .content_hash
        .as_deref()
        .is_some_and(|expected| expected != hash)
    {
        return Err(AppError::Other(
            "That file is different from the missing book.".into(),
        ));
    }
    let metadata = std::fs::metadata(&canonical)?;
    let fingerprint = scanner::quick_fingerprint(&metadata);
    repo::relink_book(
        &conn,
        &book_id,
        &canonical.to_string_lossy(),
        &fingerprint,
        &hash,
    )
}

#[tauri::command]
pub fn add_annotation(db: State<'_, Db>, annotation: Annotation) -> Result<(), AppError> {
    let conn = lock(&db)?;
    repo::add_annotation(&conn, &annotation)
}

#[tauri::command]
pub fn list_annotations(db: State<'_, Db>, book_id: String) -> Result<Vec<Annotation>, AppError> {
    let conn = lock(&db)?;
    repo::list_annotations(&conn, &book_id)
}

#[tauri::command]
pub fn update_annotation(
    db: State<'_, Db>,
    id: String,
    note: Option<String>,
    heading: Option<String>,
) -> Result<(), AppError> {
    let conn = lock(&db)?;
    repo::update_annotation_note(&conn, &id, note.as_deref(), heading.as_deref())
}

#[tauri::command]
pub fn delete_annotation(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    let conn = lock(&db)?;
    repo::delete_annotation(&conn, &id)
}

#[tauri::command]
pub fn set_reading_mode(db: State<'_, Db>, book_id: String, mode: String) -> Result<(), AppError> {
    let conn = lock(&db)?;
    repo::set_reading_mode(&conn, &book_id, &mode)
}

#[tauri::command]
pub fn list_commonplace(
    db: State<'_, Db>,
    query: CommonplaceQuery,
) -> Result<Vec<CommonplaceEntry>, AppError> {
    let conn = lock(&db)?;
    repo::list_commonplace(&conn, &query)
}

#[tauri::command]
pub fn list_headings(db: State<'_, Db>) -> Result<Vec<String>, AppError> {
    let conn = lock(&db)?;
    repo::list_headings(&conn)
}

#[tauri::command]
pub fn link_entries(db: State<'_, Db>, from_id: String, to_id: String) -> Result<(), AppError> {
    let conn = lock(&db)?;
    repo::link_annotations(&conn, &from_id, &to_id)
}

#[tauri::command]
pub fn unlink_entries(db: State<'_, Db>, from_id: String, to_id: String) -> Result<(), AppError> {
    let conn = lock(&db)?;
    repo::unlink_annotations(&conn, &from_id, &to_id)
}

#[tauri::command]
pub fn add_vocabulary(db: State<'_, Db>, entry: VocabularyEntry) -> Result<(), AppError> {
    let conn = lock(&db)?;
    repo::add_vocabulary(&conn, &entry)
}

#[tauri::command]
pub fn list_vocabulary(db: State<'_, Db>) -> Result<Vec<VocabularyEntry>, AppError> {
    let conn = lock(&db)?;
    repo::list_vocabulary(&conn)
}

#[tauri::command]
pub fn recall_available(
    db: State<'_, Db>,
    limit: Option<i64>,
) -> Result<Vec<RecallItem>, AppError> {
    let conn = lock(&db)?;
    repo::recall_available(&conn, limit.unwrap_or(20).clamp(1, 100))
}

#[tauri::command]
pub fn record_recall(
    db: State<'_, Db>,
    annotation_id: String,
    response: Option<String>,
    remembered: bool,
) -> Result<(), AppError> {
    let conn = lock(&db)?;
    repo::record_recall(&conn, &annotation_id, response.as_deref(), remembered)
}

/// Export the Commonplace + vocabulary to a chosen folder as Markdown and
/// JSON. Never copies book files. Returns the written directory.
#[tauri::command]
pub fn export_commonplace(db: State<'_, Db>, dir: String) -> Result<String, AppError> {
    let bundle = {
        let conn = lock(&db)?;
        repo::export_data(&conn)?
    };
    let root = std::fs::canonicalize(&dir)
        .map_err(|_| AppError::Other("That export folder could not be opened.".into()))?;
    if !root.is_dir() {
        return Err(AppError::Other("That is not a folder.".into()));
    }
    let out = root.join("lectorium-commonplace");
    if std::fs::symlink_metadata(&out)
        .ok()
        .is_some_and(|metadata| metadata.file_type().is_symlink())
    {
        return Err(AppError::Other(
            "The export folder is a symbolic link and cannot be used safely.".into(),
        ));
    }
    std::fs::create_dir_all(&out)?;
    let out = std::fs::canonicalize(&out)?;
    if out.parent() != Some(root.as_path()) {
        return Err(AppError::Other(
            "The export folder could not be verified.".into(),
        ));
    }

    // JSON (machine-readable, includes source locators)
    let json = serde_json::to_string_pretty(&bundle)
        .map_err(|e| AppError::Other(format!("Could not serialize export: {e}")))?;
    write_export_file(&out, "commonplace.json", json.as_bytes())?;

    // Markdown, grouped by heading (the reader's "commonplaces")
    let markdown = render_markdown(&bundle);
    write_export_file(&out, "commonplace.md", markdown.as_bytes())?;

    tracing::info!(?out, "exported commonplace");
    Ok(out.to_string_lossy().into_owned())
}

fn write_export_file(dir: &Path, name: &str, contents: &[u8]) -> Result<(), AppError> {
    let path = dir.join(name);
    if std::fs::symlink_metadata(&path)
        .ok()
        .is_some_and(|metadata| metadata.file_type().is_symlink())
    {
        return Err(AppError::Other(
            "An existing export file is a symbolic link and was not overwritten.".into(),
        ));
    }
    std::fs::write(path, contents)?;
    Ok(())
}

fn render_markdown(bundle: &repo::ExportBundle) -> String {
    use std::collections::BTreeMap;
    let mut by_heading: BTreeMap<String, Vec<&CommonplaceEntry>> = BTreeMap::new();
    for e in &bundle.entries {
        let h = e
            .commonplace_heading
            .clone()
            .unwrap_or_else(|| "Unfiled".into());
        by_heading.entry(h).or_default().push(e);
    }

    let mut md = String::from("# Commonplace\n\n");
    md.push_str(&format!("_Exported {}_\n\n", bundle.exported_at));

    for (heading, entries) in &by_heading {
        md.push_str(&format!("## {heading}\n\n"));
        for e in entries {
            if let Some(q) = &e.exact_quote {
                for line in q.lines() {
                    md.push_str(&format!("> {line}\n"));
                }
                md.push('\n');
            }
            if let Some(note) = &e.note {
                md.push_str(&format!("{note}\n\n"));
            }
            let author = e.book_authors.first().cloned().unwrap_or_default();
            let where_ = e.section_title.clone().unwrap_or_default();
            md.push_str(&format!(
                "— *{}*{}{} · {}\n\n",
                e.book_title,
                if author.is_empty() {
                    String::new()
                } else {
                    format!(", {author}")
                },
                if where_.is_empty() {
                    String::new()
                } else {
                    format!(" ({where_})")
                },
                e.kind,
            ));
            md.push_str("---\n\n");
        }
    }

    if !bundle.vocabulary.is_empty() {
        md.push_str("## Vocabulary\n\n");
        for v in &bundle.vocabulary {
            md.push_str(&format!("**{}**", v.displayed_word));
            if let Some(def) = &v.definition {
                md.push_str(&format!(" — {def}"));
            }
            md.push_str(&format!("\n> {}\n\n", v.sentence));
        }
    }
    md
}

#[derive(Serialize, Deserialize)]
pub struct SettingsPayload {
    pub version: i64,
    pub json: String,
}

#[tauri::command]
pub fn backup_now(app: AppHandle, db: State<'_, Db>) -> Result<String, AppError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::Other("Could not find the app data folder.".into()))?;
    let path = crate::db::backup_now(&db, &data_dir)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<crate::db::BackupInfo>, AppError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::Other("Could not find the app data folder.".into()))?;
    crate::db::list_backups(&data_dir)
}

#[tauri::command]
pub fn restore_backup(app: AppHandle, db: State<'_, Db>, path: String) -> Result<(), AppError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::Other("Could not find the app data folder.".into()))?;
    let candidate = std::fs::canonicalize(&path)
        .map_err(|_| AppError::Other("That backup file could not be found.".into()))?;
    let backup_dir = std::fs::canonicalize(data_dir.join("backups"))
        .map_err(|_| AppError::Other("No backup folder is available yet.".into()))?;
    if !candidate.is_file()
        || candidate.parent() != Some(backup_dir.as_path())
        || candidate.extension().and_then(|ext| ext.to_str()) != Some("db")
    {
        return Err(AppError::Other(
            "Choose a backup created by Lectorium.".into(),
        ));
    }
    crate::db::restore_from(&db, &data_dir, &candidate)
}

/// Import a previously exported `commonplace.json`. Rust reads the chosen
/// file directly so the WebView never gets arbitrary filesystem access.
#[tauri::command]
pub fn import_reading_data(
    db: State<'_, Db>,
    path: String,
) -> Result<repo::ImportReport, AppError> {
    let p = std::fs::canonicalize(&path)
        .map_err(|_| AppError::Other("That file could not be opened.".into()))?;
    if !p.is_file()
        || !p
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
    {
        return Err(AppError::Other("That file could not be opened.".into()));
    }
    if std::fs::metadata(&p)?.len() > 32 * 1024 * 1024 {
        return Err(AppError::Other("That file is too large to import.".into()));
    }
    let json = std::fs::read_to_string(&p)
        .map_err(|_| AppError::Other("Lectorium could not read that file.".into()))?;
    let conn = lock(&db)?;
    repo::import_bundle(&conn, &json)
}

#[tauri::command]
pub fn get_settings(db: State<'_, Db>) -> Result<Option<String>, AppError> {
    let conn = lock(&db)?;
    repo::get_settings(&conn)
}

#[tauri::command]
pub fn save_settings(db: State<'_, Db>, payload: SettingsPayload) -> Result<(), AppError> {
    let conn = lock(&db)?;
    repo::save_settings(&conn, payload.version, &payload.json)
}
