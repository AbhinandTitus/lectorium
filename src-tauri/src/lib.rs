mod commands;
mod db;
mod error;
mod library;
mod logging;
mod protocol;

use tauri::Manager;

/// Exposed for the dev-only `devtool` example binary; not part of the app API.
pub fn db_open_for_tools(dir: &std::path::Path) -> Result<db::Db, error::AppError> {
    db::open(dir)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("book", protocol::handle)
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

            // Catch files that changed while the app was closed: quietly
            // rescan every granted root on startup (fingerprint triage makes
            // this cheap for unchanged libraries).
            {
                let db = app.state::<db::Db>();
                let conn = db.conn.lock().expect("db lock");
                let roots = db::repo::list_roots(&conn)?;
                drop(conn);
                for root in roots {
                    library::scanner::spawn_scan(
                        app.handle().clone(),
                        root.id,
                        root.canonical_path.into(),
                    );
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_status,
            commands::list_library_roots,
            commands::add_library_root,
            commands::rescan_library,
            commands::list_books,
            commands::desk_books,
            commands::get_book,
            commands::set_desk_role,
            commands::set_book_status,
            commands::save_location,
            commands::mark_opened,
            commands::relink_book,
            commands::get_settings,
            commands::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
