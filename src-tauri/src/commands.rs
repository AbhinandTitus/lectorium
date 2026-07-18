//! The typed IPC surface. Commands stay thin: validate, delegate, return.

use crate::db::repo::{
    self, BookDetail, BookQuery, BookSummary, DeskConflict, LibraryRoot, SavedLocation,
};
use crate::db::{schema_version, Db};
use crate::error::AppError;
use crate::library::scanner;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::MutexGuard;
use tauri::{AppHandle, State};

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
    if !Path::new(&new_path).is_file() {
        return Err(AppError::Other("That file could not be opened.".into()));
    }
    let conn = lock(&db)?;
    repo::relink_book(&conn, &book_id, &new_path)
}

#[derive(Serialize, Deserialize)]
pub struct SettingsPayload {
    pub version: i64,
    pub json: String,
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
