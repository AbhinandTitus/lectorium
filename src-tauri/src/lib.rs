mod commands;
mod db;
mod error;
mod logging;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let log_dir = app.path().app_log_dir()?;
            let guard = logging::init(&log_dir);
            if let Some(guard) = guard {
                // Keep the non-blocking writer alive for the app's lifetime.
                app.manage(guard);
            }

            let data_dir = app.path().app_data_dir()?;
            let database = db::open(&data_dir)?;
            tracing::info!(db = ?database.db_path, "database ready");
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::app_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
