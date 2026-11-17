mod commands;
mod companion;
mod db;
mod drive;
mod error;
mod library;
mod logging;
mod net;
mod protocol;
mod secrets;
#[cfg(test)]
mod testserver;

use tauri::Manager;

/// Exposed for the dev-only `devtool` example binary; not part of the app API.
pub fn db_open_for_tools(dir: &std::path::Path) -> Result<db::Db, error::AppError> {
    db::open(dir)
}

/// Dev-only scan harness for the bench example. Returns (found, added).
pub fn run_scan_for_tools(
    db: &db::Db,
    covers_dir: &std::path::Path,
    root_id: i64,
    root: &std::path::Path,
    on_progress: &mut dyn FnMut(u64, u64),
) -> Result<(u64, u64), error::AppError> {
    let o = library::scanner::run_scan(db, covers_dir, root_id, root, on_progress)?;
    Ok((o.found, o.added))
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
            app.manage(secrets::Secrets(secrets::platform_store()));
            app.manage(commands::Busy::default());

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

            // The reader's standing choice, off by default: look at their
            // Drive folder once per launch. Without it, nothing here ever
            // touches the network on its own.
            commands::sync_drive_on_launch(app.handle());
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
            commands::add_annotation,
            commands::list_annotations,
            commands::update_annotation,
            commands::delete_annotation,
            commands::set_reading_mode,
            commands::list_commonplace,
            commands::list_headings,
            commands::link_entries,
            commands::unlink_entries,
            commands::add_vocabulary,
            commands::list_vocabulary,
            commands::recall_available,
            commands::record_recall,
            commands::export_commonplace,
            commands::backup_now,
            commands::list_backups,
            commands::restore_backup,
            commands::import_reading_data,
            commands::drive_status,
            commands::drive_save_config,
            commands::drive_connect,
            commands::drive_disconnect,
            commands::drive_sync,
            commands::companion_status,
            commands::companion_set_key,
            commands::companion_set_model,
            commands::companion_models,
            commands::book_text_status,
            commands::index_book_text,
            commands::companion_chapter_notes,
            commands::companion_brief,
            commands::companion_ask,
            commands::list_companion_notes,
            commands::delete_companion_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
