//! Typed repository functions. All SQL for the app lives in `db/`.

use crate::error::AppError;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRoot {
    pub id: i64,
    pub canonical_path: String,
    pub display_name: String,
    pub last_scan_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookSummary {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub language: Option<String>,
    pub source_format: String,
    pub reading_format: String,
    pub status: String,
    pub desk_role: Option<String>,
    pub cover_cache_path: Option<String>,
    pub canonical_path: String,
    pub missing: bool,
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDetail {
    #[serde(flatten)]
    pub summary: BookSummary,
    pub description: Option<String>,
    pub series: Option<String>,
    pub reading_mode: String,
    pub added_at: String,
    pub location: Option<SavedLocation>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedLocation {
    pub engine_type: String,
    pub locator_json: String,
    pub section_title: Option<String>,
    pub page_index: Option<i64>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookQuery {
    pub search: Option<String>,
    pub status: Option<String>,
    pub format: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

fn row_to_summary(row: &Row) -> rusqlite::Result<BookSummary> {
    let authors_json: String = row.get("authors")?;
    Ok(BookSummary {
        id: row.get("id")?,
        title: row.get("title")?,
        authors: serde_json::from_str(&authors_json).unwrap_or_default(),
        language: row.get("language")?,
        source_format: row.get("source_format")?,
        reading_format: row.get("reading_format")?,
        status: row.get("status")?,
        desk_role: row.get("desk_role")?,
        cover_cache_path: row.get("cover_cache_path")?,
        canonical_path: row.get("canonical_path")?,
        missing: row.get::<_, Option<String>>("missing_since")?.is_some(),
        last_opened_at: row.get("last_opened_at")?,
    })
}

const SUMMARY_COLS: &str = "id, title, authors, language, source_format, reading_format,
                            status, desk_role, cover_cache_path, canonical_path,
                            missing_since, last_opened_at";

pub fn list_roots(conn: &Connection) -> Result<Vec<LibraryRoot>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, canonical_path, display_name, last_scan_at FROM library_roots ORDER BY id",
    )?;
    let roots = stmt
        .query_map([], |r| {
            Ok(LibraryRoot {
                id: r.get(0)?,
                canonical_path: r.get(1)?,
                display_name: r.get(2)?,
                last_scan_at: r.get(3)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(roots)
}

pub fn add_root(
    conn: &Connection,
    canonical_path: &str,
    display_name: &str,
) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO library_roots (canonical_path, display_name) VALUES (?1, ?2)
         ON CONFLICT(canonical_path) DO UPDATE SET display_name = excluded.display_name",
        params![canonical_path, display_name],
    )?;
    let id = conn.query_row(
        "SELECT id FROM library_roots WHERE canonical_path = ?1",
        [canonical_path],
        |r| r.get(0),
    )?;
    Ok(id)
}

pub fn list_books(conn: &Connection, q: &BookQuery) -> Result<Vec<BookSummary>, AppError> {
    let mut sql = format!("SELECT {SUMMARY_COLS} FROM books WHERE 1=1");
    let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(search) = q.search.as_deref().filter(|s| !s.trim().is_empty()) {
        sql.push_str(
            " AND (title LIKE ?1 ESCAPE '\\' OR authors LIKE ?1 ESCAPE '\\'
               OR canonical_path LIKE ?1 ESCAPE '\\' OR series LIKE ?1 ESCAPE '\\')",
        );
        let escaped = search
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        args.push(Box::new(format!("%{escaped}%")));
    }
    if let Some(status) = q.status.as_deref().filter(|s| !s.is_empty()) {
        args.push(Box::new(status.to_string()));
        sql.push_str(&format!(" AND status = ?{}", args.len()));
    }
    if let Some(format) = q.format.as_deref().filter(|s| !s.is_empty()) {
        args.push(Box::new(format.to_string()));
        sql.push_str(&format!(" AND source_format = ?{}", args.len()));
    }
    sql.push_str(" ORDER BY title COLLATE NOCASE");
    sql.push_str(&format!(
        " LIMIT {} OFFSET {}",
        q.limit.unwrap_or(200).clamp(1, 500),
        q.offset.unwrap_or(0).max(0)
    ));

    let mut stmt = conn.prepare(&sql)?;
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let books = stmt
        .query_map(params_ref.as_slice(), row_to_summary)?
        .collect::<Result<_, _>>()?;
    Ok(books)
}

pub fn count_books(conn: &Connection) -> Result<i64, AppError> {
    Ok(conn.query_row("SELECT count(*) FROM books", [], |r| r.get(0))?)
}

pub fn desk_books(conn: &Connection) -> Result<Vec<BookSummary>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SUMMARY_COLS} FROM books WHERE desk_role IS NOT NULL
         ORDER BY CASE desk_role WHEN 'current' THEN 0 WHEN 'companion' THEN 1 ELSE 2 END"
    ))?;
    let books = stmt
        .query_map([], row_to_summary)?
        .collect::<Result<_, _>>()?;
    Ok(books)
}

pub fn get_book(conn: &Connection, id: &str) -> Result<BookDetail, AppError> {
    let detail = conn
        .query_row(
            &format!(
                "SELECT {SUMMARY_COLS}, description, series, reading_mode, added_at
                 FROM books WHERE id = ?1"
            ),
            [id],
            |row| {
                Ok(BookDetail {
                    summary: row_to_summary(row)?,
                    description: row.get("description")?,
                    series: row.get("series")?,
                    reading_mode: row.get("reading_mode")?,
                    added_at: row.get("added_at")?,
                    location: None,
                })
            },
        )
        .optional()?
        .ok_or_else(|| AppError::Other("This book is no longer in the library.".into()))?;

    let location = conn
        .query_row(
            "SELECT engine_type, locator_json, section_title, page_index, updated_at
             FROM book_locations WHERE book_id = ?1",
            [id],
            |r| {
                Ok(SavedLocation {
                    engine_type: r.get(0)?,
                    locator_json: r.get(1)?,
                    section_title: r.get(2)?,
                    page_index: r.get(3)?,
                    updated_at: r.get(4)?,
                })
            },
        )
        .optional()?;

    Ok(BookDetail { location, ..detail })
}

/// Occupant info returned when a desk role is already taken.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeskConflict {
    pub role: String,
    pub occupant_id: String,
    pub occupant_title: String,
}

pub fn set_desk_role(
    conn: &Connection,
    book_id: &str,
    role: Option<&str>,
    replace: bool,
) -> Result<Option<DeskConflict>, AppError> {
    if let Some(role) = role {
        if !matches!(role, "current" | "companion" | "short") {
            return Err(AppError::Other("Unknown desk role.".into()));
        }
        let occupant: Option<(String, String)> = conn
            .query_row(
                "SELECT id, title FROM books WHERE desk_role = ?1 AND id != ?2",
                params![role, book_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((occupant_id, occupant_title)) = occupant {
            if !replace {
                return Ok(Some(DeskConflict {
                    role: role.into(),
                    occupant_id,
                    occupant_title,
                }));
            }
            // The displaced book returns to the shelf — a neutral state.
            conn.execute(
                "UPDATE books SET desk_role = NULL, status = 'shelf' WHERE id = ?1",
                [&occupant_id],
            )?;
        }
        conn.execute(
            "UPDATE books SET desk_role = ?2, status = 'desk' WHERE id = ?1",
            params![book_id, role],
        )?;
    } else {
        conn.execute(
            "UPDATE books SET desk_role = NULL,
                              status = CASE WHEN status = 'desk' THEN 'shelf' ELSE status END
             WHERE id = ?1",
            [book_id],
        )?;
    }
    Ok(None)
}

pub fn set_status(conn: &Connection, book_id: &str, status: &str) -> Result<(), AppError> {
    if !matches!(status, "shelf" | "paused" | "completed" | "reference") {
        return Err(AppError::Other("Unknown book status.".into()));
    }
    conn.execute(
        "UPDATE books SET status = ?2,
                          desk_role = CASE WHEN ?2 = 'desk' THEN desk_role ELSE NULL END,
                          completed_at = CASE WHEN ?2 = 'completed'
                                              THEN strftime('%Y-%m-%dT%H:%M:%fZ','now')
                                              ELSE completed_at END
         WHERE id = ?1",
        params![book_id, status],
    )?;
    Ok(())
}

pub fn save_location(
    conn: &Connection,
    book_id: &str,
    loc: &SavedLocation,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO book_locations (book_id, engine_type, locator_json, section_title, page_index, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(book_id) DO UPDATE SET
             engine_type = excluded.engine_type,
             locator_json = excluded.locator_json,
             section_title = excluded.section_title,
             page_index = excluded.page_index,
             updated_at = excluded.updated_at",
        params![
            book_id,
            loc.engine_type,
            loc.locator_json,
            loc.section_title,
            loc.page_index
        ],
    )?;
    Ok(())
}

pub fn mark_opened(conn: &Connection, book_id: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE books SET last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
        [book_id],
    )?;
    Ok(())
}

pub fn relink_book(conn: &Connection, book_id: &str, new_path: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE books SET canonical_path = ?2, missing_since = NULL, content_hash = NULL,
                          quick_fingerprint = NULL
         WHERE id = ?1",
        params![book_id, new_path],
    )?;
    Ok(())
}

/// The book whose reading location was most recently updated.
pub fn most_recent_book_id(conn: &Connection) -> Result<Option<String>, AppError> {
    Ok(conn
        .query_row(
            "SELECT l.book_id FROM book_locations l
             JOIN books b ON b.id = l.book_id AND b.missing_since IS NULL
             ORDER BY l.updated_at DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn get_settings(conn: &Connection) -> Result<Option<String>, AppError> {
    Ok(conn
        .query_row("SELECT json FROM settings WHERE id = 1", [], |r| r.get(0))
        .optional()?)
}

pub fn save_settings(conn: &Connection, version: i64, json: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO settings (id, version, json) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version, json = excluded.json",
        params![version, json],
    )?;
    Ok(())
}
