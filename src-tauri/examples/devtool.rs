//! Dev/test utility (never shipped): seed and inspect the app database so
//! smoke tests can bypass the native folder dialog.
//!
//!   cargo run --example devtool -- <db-dir> seed-root <library-path>
//!   cargo run --example devtool -- <db-dir> onboarded
//!   cargo run --example devtool -- <db-dir> set-desk <title-substring> <role>
//!   cargo run --example devtool -- <db-dir> dump

use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: devtool <db-dir> <command> [...]");
        std::process::exit(2);
    }
    let db = lectorium_lib::db_open_for_tools(Path::new(&args[1])).expect("open db");
    let conn = db.conn.lock().unwrap();

    match args[2].as_str() {
        "seed-root" => {
            let path = std::fs::canonicalize(&args[3]).expect("library path");
            conn.execute(
                "INSERT INTO library_roots (canonical_path, display_name) VALUES (?1, 'smoke')
                 ON CONFLICT(canonical_path) DO NOTHING",
                [path.to_string_lossy().to_string()],
            )
            .unwrap();
            println!("root seeded: {}", path.display());
        }
        "onboarded" => {
            conn.execute(
                r#"INSERT INTO settings (id, version, json)
                   VALUES (1, 1, '{"version":1,"theme":"ember","typographyPreset":"open","directResume":false,"onboarded":true}')
                   ON CONFLICT(id) DO UPDATE SET json = excluded.json"#,
                [],
            )
            .unwrap();
            println!("onboarded");
        }
        "set-desk" => {
            let pattern = format!("%{}%", args[3]);
            let role = args[4].as_str();
            conn.execute(
                "UPDATE books SET desk_role = ?2, status = 'desk'
                 WHERE title LIKE ?1 AND id = (SELECT id FROM books WHERE title LIKE ?1 LIMIT 1)",
                rusqlite::params![pattern, role],
            )
            .unwrap();
            println!("desk set");
        }
        "remove-root" => {
            // Removes a library root and every book under it (test cleanup).
            let pattern = format!("%{}%", args[3]);
            let books = conn
                .execute("DELETE FROM books WHERE canonical_path LIKE ?1", [&pattern])
                .unwrap();
            let roots = conn
                .execute(
                    "DELETE FROM library_roots WHERE canonical_path LIKE ?1",
                    [&pattern],
                )
                .unwrap();
            println!("removed {books} books, {roots} roots matching {}", args[3]);
        }
        "dump" => {
            let mut stmt = conn
                .prepare(
                    "SELECT title, source_format, status, IFNULL(desk_role,'-'),
                            IFNULL(missing_since,'-') FROM books ORDER BY title",
                )
                .unwrap();
            let rows = stmt
                .query_map([], |r| {
                    Ok(format!(
                        "{} | {} | {} | desk:{} | missing:{}",
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?
                    ))
                })
                .unwrap();
            for row in rows.flatten() {
                println!("BOOK {row}");
            }
            let mut stmt = conn
                .prepare(
                    "SELECT b.title, l.engine_type, l.locator_json, IFNULL(l.section_title,'-')
                     FROM book_locations l JOIN books b ON b.id = l.book_id",
                )
                .unwrap();
            let rows = stmt
                .query_map([], |r| {
                    Ok(format!(
                        "{} | {} | {} | {}",
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?
                    ))
                })
                .unwrap();
            for row in rows.flatten() {
                println!("LOC {row}");
            }
        }
        other => {
            eprintln!("unknown command {other}");
            std::process::exit(2);
        }
    }
}
