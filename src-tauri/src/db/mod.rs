//! Durable local storage: SQLite behind typed repositories.
//!
//! The frontend never sees SQL. Commands call repository functions that
//! borrow the shared connection from managed state.

mod migrations;
pub mod repo;

use crate::error::AppError;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Db {
    pub conn: Mutex<Connection>,
    pub db_path: PathBuf,
}

/// How many rotating pre-migration backups to keep.
const BACKUP_KEEP: usize = 8;

pub fn open(app_data_dir: &Path) -> Result<Db, AppError> {
    fs::create_dir_all(app_data_dir)?;
    let db_path = app_data_dir.join("lectorium.db");
    let mut conn = Connection::open(&db_path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;

    migrate(&mut conn, &db_path, app_data_dir)?;
    Ok(Db {
        conn: Mutex::new(conn),
        db_path,
    })
}

pub fn schema_version(conn: &Connection) -> Result<i64, AppError> {
    let version = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    Ok(version)
}

fn migrate(conn: &mut Connection, db_path: &Path, app_data_dir: &Path) -> Result<(), AppError> {
    let current = schema_version(conn)?;
    let pending: Vec<_> = migrations::MIGRATIONS
        .iter()
        .filter(|m| m.version > current)
        .collect();
    if pending.is_empty() {
        return Ok(());
    }

    // Atomic snapshot before touching the schema. VACUUM INTO is safe on a
    // live database and produces a consistent single-file copy.
    if current > 0 {
        backup_before_migration(conn, db_path, app_data_dir)?;
    }

    for m in pending {
        tracing::info!(version = m.version, name = m.name, "applying migration");
        let tx = conn.transaction()?;
        tx.execute_batch(m.sql)?;
        tx.pragma_update(None, "user_version", m.version)?;
        tx.commit()?;
    }
    Ok(())
}

fn backup_before_migration(
    conn: &Connection,
    db_path: &Path,
    app_data_dir: &Path,
) -> Result<(), AppError> {
    let backup_dir = app_data_dir.join("backups");
    fs::create_dir_all(&backup_dir)?;

    let stamp = time_stamp();
    let target = backup_dir.join(format!("lectorium-pre-migration-{stamp}.db"));
    // VACUUM INTO refuses to overwrite; the second-resolution stamp plus a
    // counter suffix keeps names unique within one second.
    let target = unique_path(target);
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().to_string()])?;
    tracing::info!(?target, source = ?db_path, "database backed up before migration");

    rotate_backups(&backup_dir)?;
    Ok(())
}

fn unique_path(candidate: PathBuf) -> PathBuf {
    if !candidate.exists() {
        return candidate;
    }
    let stem = candidate
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = candidate
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let parent = candidate
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();
    for i in 1.. {
        let next = parent.join(format!("{stem}-{i}.{ext}"));
        if !next.exists() {
            return next;
        }
    }
    unreachable!()
}

fn rotate_backups(backup_dir: &Path) -> Result<(), AppError> {
    let mut backups: Vec<_> = fs::read_dir(backup_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "db"))
        .collect();
    backups.sort();
    while backups.len() > BACKUP_KEEP {
        let oldest = backups.remove(0);
        tracing::info!(?oldest, "rotating out old backup");
        fs::remove_file(oldest)?;
    }
    Ok(())
}

fn time_stamp() -> String {
    // SQLite's clock keeps us dependency-free for a filename-safe UTC stamp.
    let conn = Connection::open_in_memory();
    conn.and_then(|c| {
        c.query_row("SELECT strftime('%Y%m%d-%H%M%S','now')", [], |r| {
            r.get::<_, String>(0)
        })
    })
    .unwrap_or_else(|_| "unknown-time".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lectorium-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn migrates_fresh_database_to_latest() {
        let dir = temp_dir("fresh");
        let db = open(&dir).unwrap();
        let conn = db.conn.lock().unwrap();
        let version = schema_version(&conn).unwrap();
        assert_eq!(version, migrations::MIGRATIONS.last().unwrap().version);

        // spot-check the schema is really there
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN
                 ('library_roots','books','book_locations','annotations','vocabulary',
                  'links','recall_state','settings')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 8);
        drop(conn);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn reopening_is_idempotent_and_keeps_data() {
        let dir = temp_dir("reopen");
        {
            let db = open(&dir).unwrap();
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO books (id, canonical_path, source_format, reading_format, title)
                 VALUES ('b1', 'C:/x/book.epub', 'epub', 'epub', 'A Book')",
                [],
            )
            .unwrap();
        }
        let db = open(&dir).unwrap();
        let conn = db.conn.lock().unwrap();
        let title: String = conn
            .query_row("SELECT title FROM books WHERE id='b1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "A Book");
        drop(conn);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn desk_role_uniqueness_is_enforced() {
        let dir = temp_dir("desk");
        let db = open(&dir).unwrap();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO books (id, canonical_path, source_format, reading_format, title, status, desk_role)
             VALUES ('b1','C:/a.epub','epub','epub','A','desk','current')",
            [],
        )
        .unwrap();
        let second = conn.execute(
            "INSERT INTO books (id, canonical_path, source_format, reading_format, title, status, desk_role)
             VALUES ('b2','C:/b.epub','epub','epub','B','desk','current')",
            [],
        );
        assert!(second.is_err(), "two books must not share a desk role");
        drop(conn);
        let _ = fs::remove_dir_all(dir);
    }
}
