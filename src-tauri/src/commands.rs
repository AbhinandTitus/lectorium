//! The typed IPC surface. Commands stay thin: validate, delegate, return.

use crate::db::{schema_version, Db};
use crate::error::AppError;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub app_version: String,
    pub db_schema_version: i64,
    pub db_path: String,
}

/// Startup health check: proves IPC and the migrated database both work.
#[tauri::command]
pub fn app_status(db: State<'_, Db>) -> Result<AppStatus, AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| AppError::Other("Lectorium's database is busy. Please try again.".into()))?;
    Ok(AppStatus {
        app_version: env!("CARGO_PKG_VERSION").into(),
        db_schema_version: schema_version(&conn)?,
        db_path: db.db_path.to_string_lossy().into_owned(),
    })
}
