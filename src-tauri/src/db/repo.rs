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

pub struct RelinkIdentity {
    pub source_format: String,
    pub content_hash: Option<String>,
}

pub fn relink_identity(conn: &Connection, book_id: &str) -> Result<RelinkIdentity, AppError> {
    conn.query_row(
        "SELECT source_format, content_hash FROM books WHERE id = ?1",
        [book_id],
        |r| {
            Ok(RelinkIdentity {
                source_format: r.get(0)?,
                content_hash: r.get(1)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::Other("This book is no longer in the library.".into()))
}

pub fn relink_book(
    conn: &Connection,
    book_id: &str,
    new_path: &str,
    fingerprint: &str,
    content_hash: &str,
) -> Result<(), AppError> {
    let collision: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM books WHERE canonical_path = ?1 AND id != ?2)",
        params![new_path, book_id],
        |r| r.get(0),
    )?;
    if collision {
        return Err(AppError::Other(
            "That file is already connected to another library entry.".into(),
        ));
    }
    conn.execute(
        "UPDATE books SET canonical_path = ?2, missing_since = NULL, content_hash = ?3,
                          quick_fingerprint = ?4
         WHERE id = ?1",
        params![book_id, new_path, content_hash, fingerprint],
    )?;
    Ok(())
}

// ---- Library scanner persistence ----

pub struct ScannedBook<'a> {
    pub id: &'a str,
    pub fingerprint: &'a str,
    pub canonical_path: &'a str,
    pub source_format: &'a str,
    pub reading_format: &'a str,
    pub title: &'a str,
    pub authors_json: &'a str,
    pub language: Option<&'a str>,
    pub description: Option<&'a str>,
    pub cover_cache_path: Option<&'a str>,
}

pub fn scan_existing_by_path(
    conn: &Connection,
    canonical_path: &str,
) -> Result<Option<(String, Option<String>)>, AppError> {
    Ok(conn
        .query_row(
            "SELECT id, quick_fingerprint FROM books WHERE canonical_path = ?1",
            [canonical_path],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

pub fn scan_clear_missing(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE books SET missing_since = NULL WHERE id = ?1 AND missing_since IS NOT NULL",
        [id],
    )?;
    Ok(())
}

pub fn scan_update_changed(conn: &Connection, book: &ScannedBook<'_>) -> Result<(), AppError> {
    conn.execute(
        "UPDATE books SET quick_fingerprint = ?2, content_hash = NULL,
                          missing_since = NULL, source_format = ?3,
                          reading_format = ?4, title = ?5, authors = ?6,
                          language = ?7, description = ?8, cover_cache_path = ?9
         WHERE id = ?1",
        params![
            book.id,
            book.fingerprint,
            book.source_format,
            book.reading_format,
            book.title,
            book.authors_json,
            book.language,
            book.description,
            book.cover_cache_path,
        ],
    )?;
    Ok(())
}

pub fn scan_insert(conn: &Connection, book: &ScannedBook<'_>) -> Result<bool, AppError> {
    Ok(conn.execute(
        "INSERT INTO books (id, quick_fingerprint, canonical_path, source_format,
                            reading_format, title, authors, language, description, cover_cache_path)
         SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10
         WHERE NOT EXISTS (SELECT 1 FROM books WHERE canonical_path = ?3)",
        params![
            book.id,
            book.fingerprint,
            book.canonical_path,
            book.source_format,
            book.reading_format,
            book.title,
            book.authors_json,
            book.language,
            book.description,
            book.cover_cache_path,
        ],
    )? > 0)
}

pub fn scan_present_paths(conn: &Connection) -> Result<Vec<(String, String)>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, canonical_path FROM books
         WHERE missing_since IS NULL",
    )?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn scan_mark_missing(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE books SET missing_since = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

pub fn scan_mark_root_complete(conn: &Connection, root_id: i64) -> Result<(), AppError> {
    conn.execute(
        "UPDATE library_roots SET last_scan_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?1",
        [root_id],
    )?;
    Ok(())
}

pub fn scan_hash_pending(conn: &Connection) -> Result<Vec<(String, String)>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, canonical_path FROM books
         WHERE content_hash IS NULL AND missing_since IS NULL",
    )?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn scan_missing_with_hash(
    conn: &Connection,
    hash: &str,
    except_id: &str,
) -> Result<Option<String>, AppError> {
    Ok(conn
        .query_row(
            "SELECT id FROM books
             WHERE content_hash = ?1 AND missing_since IS NOT NULL AND id != ?2 LIMIT 1",
            params![hash, except_id],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn scan_book_has_no_user_data(conn: &Connection, id: &str) -> Result<bool, AppError> {
    Ok(conn.query_row(
        "SELECT NOT EXISTS(SELECT 1 FROM annotations WHERE book_id = ?1)
            AND NOT EXISTS(SELECT 1 FROM book_locations WHERE book_id = ?1)",
        [id],
        |r| r.get(0),
    )?)
}

pub fn scan_relink_moved(
    conn: &Connection,
    old_id: &str,
    fresh_id: &str,
    hash: &str,
) -> Result<(), AppError> {
    conn.execute(
        "UPDATE books SET canonical_path = (SELECT canonical_path FROM books WHERE id = ?2),
                          quick_fingerprint = (SELECT quick_fingerprint FROM books WHERE id = ?2),
                          content_hash = ?3, missing_since = NULL
         WHERE id = ?1",
        params![old_id, fresh_id, hash],
    )?;
    conn.execute("DELETE FROM books WHERE id = ?1", [fresh_id])?;
    Ok(())
}

pub fn scan_live_with_hash(
    conn: &Connection,
    hash: &str,
    except_id: &str,
) -> Result<Option<String>, AppError> {
    Ok(conn
        .query_row(
            "SELECT id FROM books
             WHERE content_hash = ?1 AND missing_since IS NULL AND id != ?2
             ORDER BY added_at, id LIMIT 1",
            params![hash, except_id],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn scan_delete_book(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM books WHERE id = ?1", [id])?;
    Ok(())
}

pub fn scan_set_hash(conn: &Connection, id: &str, hash: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE books SET content_hash = ?2 WHERE id = ?1",
        params![id, hash],
    )?;
    Ok(())
}

#[cfg(test)]
pub fn scan_hashed_count(conn: &Connection) -> Result<i64, AppError> {
    Ok(conn.query_row(
        "SELECT count(*) FROM books WHERE content_hash IS NOT NULL",
        [],
        |r| r.get(0),
    )?)
}

pub fn protocol_book_source(
    conn: &Connection,
    id: &str,
) -> Result<Option<(String, String)>, AppError> {
    Ok(conn
        .query_row(
            "SELECT canonical_path, source_format FROM books WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

pub fn protocol_cover_path(conn: &Connection, id: &str) -> Result<Option<String>, AppError> {
    Ok(conn
        .query_row(
            "SELECT cover_cache_path FROM books WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .flatten())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub book_id: String,
    pub kind: String,
    pub start_locator_json: String,
    pub end_locator_json: Option<String>,
    pub exact_quote: Option<String>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub note: Option<String>,
    pub color_token: Option<String>,
    pub commonplace_heading: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

pub fn add_annotation(conn: &Connection, a: &Annotation) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO annotations (id, book_id, kind, start_locator_json, end_locator_json,
                                  exact_quote, prefix, suffix, note, color_token,
                                  commonplace_heading, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,
                 COALESCE(?12, strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
        params![
            a.id,
            a.book_id,
            a.kind,
            a.start_locator_json,
            a.end_locator_json,
            a.exact_quote,
            a.prefix,
            a.suffix,
            a.note,
            a.color_token,
            a.commonplace_heading,
            a.created_at
        ],
    )?;
    Ok(())
}

pub fn list_annotations(conn: &Connection, book_id: &str) -> Result<Vec<Annotation>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, book_id, kind, start_locator_json, end_locator_json, exact_quote,
                prefix, suffix, note, color_token, commonplace_heading, created_at
         FROM annotations WHERE book_id = ?1 ORDER BY created_at",
    )?;
    let rows = stmt
        .query_map([book_id], |r| {
            Ok(Annotation {
                id: r.get(0)?,
                book_id: r.get(1)?,
                kind: r.get(2)?,
                start_locator_json: r.get(3)?,
                end_locator_json: r.get(4)?,
                exact_quote: r.get(5)?,
                prefix: r.get(6)?,
                suffix: r.get(7)?,
                note: r.get(8)?,
                color_token: r.get(9)?,
                commonplace_heading: r.get(10)?,
                created_at: r.get(11)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn update_annotation_note(
    conn: &Connection,
    id: &str,
    note: Option<&str>,
    heading: Option<&str>,
) -> Result<(), AppError> {
    conn.execute(
        "UPDATE annotations SET note = ?2, commonplace_heading = ?3,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
        params![id, note, heading],
    )?;
    Ok(())
}

pub fn delete_annotation(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM annotations WHERE id = ?1", [id])?;
    Ok(())
}

/// A Commonplace entry joined with its book, for the Commonplace space.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommonplaceEntry {
    pub id: String,
    pub book_id: String,
    pub book_title: String,
    pub book_authors: Vec<String>,
    pub kind: String,
    pub exact_quote: Option<String>,
    pub note: Option<String>,
    pub commonplace_heading: Option<String>,
    pub section_title: Option<String>,
    pub start_locator_json: String,
    pub end_locator_json: Option<String>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub color_token: Option<String>,
    pub engine_type: String,
    pub created_at: String,
    pub linked_ids: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommonplaceQuery {
    pub search: Option<String>,
    pub heading: Option<String>,
    pub kind: Option<String>,
    pub book_id: Option<String>,
}

pub fn list_commonplace(
    conn: &Connection,
    q: &CommonplaceQuery,
) -> Result<Vec<CommonplaceEntry>, AppError> {
    list_commonplace_with_limit(conn, q, Some(1000))
}

fn section_title_from_locator(locator_json: &str) -> Option<String> {
    let locator: serde_json::Value = serde_json::from_str(locator_json).ok()?;
    let section = locator
        .get("coarse")
        .and_then(|coarse| coarse.get("sectionTitle"))
        .and_then(|title| title.as_str())
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_owned);
    if section.is_some() {
        return section;
    }
    if locator.get("engine").and_then(|engine| engine.as_str()) == Some("pdf") {
        return locator
            .get("primary")
            .and_then(|primary| primary.get("pageLabel"))
            .and_then(|label| label.as_str())
            .map(|label| format!("Page {label}"));
    }
    None
}

fn list_commonplace_with_limit(
    conn: &Connection,
    q: &CommonplaceQuery,
    limit: Option<i64>,
) -> Result<Vec<CommonplaceEntry>, AppError> {
    // Commonplace shows reflective/kept kinds, not raw bookmarks/highlights.
    let mut sql = String::from(
        "SELECT a.id, a.book_id, b.title, b.authors, a.kind, a.exact_quote, a.note,
                a.commonplace_heading, a.start_locator_json, b.reading_format, a.created_at,
                a.end_locator_json, a.prefix, a.suffix, a.color_token
         FROM annotations a JOIN books b ON b.id = a.book_id
         WHERE a.kind IN ('quote','idea','question','vocabulary','action','character','free','note','highlight')",
    );
    let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(search) = q.search.as_deref().filter(|s| !s.trim().is_empty()) {
        let escaped = search
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        args.push(Box::new(format!("%{escaped}%")));
        let n = args.len();
        sql.push_str(&format!(
            " AND (a.exact_quote LIKE ?{n} ESCAPE '\\' OR a.note LIKE ?{n} ESCAPE '\\'
                OR a.commonplace_heading LIKE ?{n} ESCAPE '\\' OR b.title LIKE ?{n} ESCAPE '\\')"
        ));
    }
    if let Some(heading) = q.heading.as_deref().filter(|s| !s.is_empty()) {
        args.push(Box::new(heading.to_string()));
        sql.push_str(&format!(" AND a.commonplace_heading = ?{}", args.len()));
    }
    if let Some(kind) = q.kind.as_deref().filter(|s| !s.is_empty()) {
        args.push(Box::new(kind.to_string()));
        sql.push_str(&format!(" AND a.kind = ?{}", args.len()));
    }
    if let Some(book_id) = q.book_id.as_deref().filter(|s| !s.is_empty()) {
        args.push(Box::new(book_id.to_string()));
        sql.push_str(&format!(" AND a.book_id = ?{}", args.len()));
    }
    sql.push_str(" ORDER BY a.created_at DESC");
    if let Some(limit) = limit {
        sql.push_str(&format!(" LIMIT {}", limit.clamp(1, 10_000)));
    }

    let mut stmt = conn.prepare(&sql)?;
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let mut entries: Vec<CommonplaceEntry> = stmt
        .query_map(params_ref.as_slice(), |r| {
            let authors_json: String = r.get(3)?;
            Ok(CommonplaceEntry {
                id: r.get(0)?,
                book_id: r.get(1)?,
                book_title: r.get(2)?,
                book_authors: serde_json::from_str(&authors_json).unwrap_or_default(),
                kind: r.get(4)?,
                exact_quote: r.get(5)?,
                note: r.get(6)?,
                commonplace_heading: r.get(7)?,
                start_locator_json: r.get(8)?,
                engine_type: r.get(9)?,
                created_at: r.get(10)?,
                end_locator_json: r.get(11)?,
                prefix: r.get(12)?,
                suffix: r.get(13)?,
                color_token: r.get(14)?,
                section_title: None,
                linked_ids: Vec::new(),
            })
        })?
        .collect::<Result<_, _>>()?;

    // attach cross-links
    for entry in &mut entries {
        entry.section_title = section_title_from_locator(&entry.start_locator_json);
        let mut link_stmt = conn.prepare(
            "SELECT to_annotation_id FROM links WHERE from_annotation_id = ?1
             UNION SELECT from_annotation_id FROM links WHERE to_annotation_id = ?1",
        )?;
        entry.linked_ids = link_stmt
            .query_map([&entry.id], |r| r.get(0))?
            .filter_map(|r| r.ok())
            .collect();
    }
    Ok(entries)
}

pub fn list_headings(conn: &Connection) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT commonplace_heading FROM annotations
         WHERE commonplace_heading IS NOT NULL AND commonplace_heading != ''
         ORDER BY commonplace_heading COLLATE NOCASE",
    )?;
    let headings = stmt
        .query_map([], |r| r.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(headings)
}

pub fn link_annotations(conn: &Connection, from_id: &str, to_id: &str) -> Result<(), AppError> {
    if from_id == to_id {
        return Err(AppError::Other("An entry cannot link to itself.".into()));
    }
    // store one canonical direction to avoid duplicate reverse rows
    let (a, b) = if from_id < to_id {
        (from_id, to_id)
    } else {
        (to_id, from_id)
    };
    conn.execute(
        "INSERT OR IGNORE INTO links (from_annotation_id, to_annotation_id) VALUES (?1, ?2)",
        params![a, b],
    )?;
    Ok(())
}

pub fn unlink_annotations(conn: &Connection, from_id: &str, to_id: &str) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM links WHERE (from_annotation_id = ?1 AND to_annotation_id = ?2)
                              OR (from_annotation_id = ?2 AND to_annotation_id = ?1)",
        params![from_id, to_id],
    )?;
    Ok(())
}

// ---- Vocabulary ----

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyEntry {
    pub id: String,
    pub book_id: String,
    pub normalized_word: String,
    pub displayed_word: String,
    pub sentence: String,
    pub definition: Option<String>,
    pub locator_json: String,
    pub note: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub book_title: Option<String>,
    #[serde(default)]
    pub book_authors: Vec<String>,
}

pub fn add_vocabulary(conn: &Connection, v: &VocabularyEntry) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO vocabulary (id, book_id, normalized_word, displayed_word, sentence,
                                 definition, locator_json, note, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,
                 COALESCE(?9, strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
        params![
            v.id,
            v.book_id,
            v.normalized_word,
            v.displayed_word,
            v.sentence,
            v.definition,
            v.locator_json,
            v.note,
            v.created_at
        ],
    )?;
    Ok(())
}

pub fn list_vocabulary(conn: &Connection) -> Result<Vec<VocabularyEntry>, AppError> {
    list_vocabulary_with_limit(conn, Some(2000))
}

fn list_vocabulary_with_limit(
    conn: &Connection,
    limit: Option<i64>,
) -> Result<Vec<VocabularyEntry>, AppError> {
    let limit_sql = limit
        .map(|value| format!(" LIMIT {}", value.clamp(1, 20_000)))
        .unwrap_or_default();
    let mut stmt = conn.prepare(&format!(
        "SELECT v.id, v.book_id, v.normalized_word, v.displayed_word, v.sentence, v.definition,
                    v.locator_json, v.note, v.created_at, b.title, b.authors
             FROM vocabulary v JOIN books b ON b.id = v.book_id
             ORDER BY v.created_at DESC{limit_sql}"
    ))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(VocabularyEntry {
                id: r.get(0)?,
                book_id: r.get(1)?,
                normalized_word: r.get(2)?,
                displayed_word: r.get(3)?,
                sentence: r.get(4)?,
                definition: r.get(5)?,
                locator_json: r.get(6)?,
                note: r.get(7)?,
                created_at: r.get(8)?,
                book_title: r.get(9)?,
                book_authors: serde_json::from_str(&r.get::<_, String>(10)?).unwrap_or_default(),
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

// ---- Recall (opt-in, non-scored) ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallItem {
    pub annotation_id: String,
    pub book_id: String,
    pub cue: String,
    pub kind: String,
    pub book_title: String,
    pub exact_quote: Option<String>,
    pub note: Option<String>,
    pub start_locator_json: String,
}

/// Items available for Recall now: kept entries whose `available_after` has
/// passed (or is unset). Spacing schedules availability; the queue is never
/// forced and no score is kept.
pub fn recall_available(conn: &Connection, limit: i64) -> Result<Vec<RecallItem>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.commonplace_heading, a.kind, b.title, a.exact_quote, a.note,
                a.book_id, a.start_locator_json
         FROM annotations a
         JOIN books b ON b.id = a.book_id
         LEFT JOIN recall_state r ON r.item_type = 'annotation' AND r.item_id = a.id
         WHERE a.kind IN ('quote','idea','question','character','action')
           AND (r.available_after IS NULL OR r.available_after <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ORDER BY COALESCE(r.last_seen_at, '') ASC, a.created_at DESC
         LIMIT ?1",
    )?;
    let rows = stmt
        .query_map([limit], |r| {
            let heading: Option<String> = r.get(1)?;
            let quote: Option<String> = r.get(4)?;
            let note: Option<String> = r.get(5)?;
            // the cue is the reader's own heading/note — never the passage
            let cue = heading
                .clone()
                .or_else(|| note.clone())
                .unwrap_or_else(|| "What do you remember here?".into());
            Ok(RecallItem {
                annotation_id: r.get(0)?,
                cue,
                kind: r.get(2)?,
                book_title: r.get(3)?,
                exact_quote: quote,
                note,
                book_id: r.get(6)?,
                start_locator_json: r.get(7)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Record a Recall review. Spacing: push availability out by an increasing
/// interval. The interval is not shown to the user and there is no grade.
pub fn record_recall(
    conn: &Connection,
    annotation_id: &str,
    response: Option<&str>,
    remembered: bool,
) -> Result<(), AppError> {
    // simple expanding schedule: remembered → longer, else → short retry
    let days = if remembered { 7 } else { 1 };
    conn.execute(
        "INSERT INTO recall_state (item_type, item_id, available_after, last_seen_at, reader_response)
         VALUES ('annotation', ?1,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now', ?2),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?3)
         ON CONFLICT(item_type, item_id) DO UPDATE SET
             available_after = strftime('%Y-%m-%dT%H:%M:%fZ','now', ?2),
             last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             reader_response = COALESCE(?3, reader_response)",
        params![annotation_id, format!("+{days} days"), response],
    )?;
    Ok(())
}

/// Everything needed to export the Commonplace (all kept entries + vocab).
pub fn export_data(conn: &Connection) -> Result<ExportBundle, AppError> {
    let entries = list_commonplace_with_limit(conn, &CommonplaceQuery::default(), None)?;
    let vocabulary = list_export_vocabulary(conn)?;
    Ok(ExportBundle {
        version: 2,
        exported_at: conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |r| {
            r.get(0)
        })?,
        entries,
        vocabulary,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBundle {
    pub version: i64,
    pub exported_at: String,
    pub entries: Vec<CommonplaceEntry>,
    pub vocabulary: Vec<ExportVocabularyEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportVocabularyEntry {
    pub id: String,
    pub book_id: String,
    pub book_title: String,
    pub book_authors: Vec<String>,
    pub normalized_word: String,
    pub displayed_word: String,
    pub sentence: String,
    pub definition: Option<String>,
    pub locator_json: String,
    pub note: Option<String>,
    pub created_at: Option<String>,
}

fn list_export_vocabulary(conn: &Connection) -> Result<Vec<ExportVocabularyEntry>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT v.id, v.book_id, b.title, b.authors, v.normalized_word, v.displayed_word,
                v.sentence, v.definition, v.locator_json, v.note, v.created_at
         FROM vocabulary v JOIN books b ON b.id = v.book_id
         ORDER BY v.created_at DESC",
    )?;
    let entries = stmt
        .query_map([], |r| {
            let authors_json: String = r.get(3)?;
            Ok(ExportVocabularyEntry {
                id: r.get(0)?,
                book_id: r.get(1)?,
                book_title: r.get(2)?,
                book_authors: serde_json::from_str(&authors_json).unwrap_or_default(),
                normalized_word: r.get(4)?,
                displayed_word: r.get(5)?,
                sentence: r.get(6)?,
                definition: r.get(7)?,
                locator_json: r.get(8)?,
                note: r.get(9)?,
                created_at: r.get(10)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(entries)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported_entries: i64,
    pub imported_vocabulary: i64,
    pub skipped_no_book: i64,
    pub skipped_duplicate: i64,
}

fn valid_locator_json(json: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        return false;
    };
    if value.get("v").and_then(|v| v.as_i64()) != Some(1) {
        return false;
    }
    let Some(primary) = value.get("primary").and_then(|v| v.as_object()) else {
        return false;
    };
    let Some(coarse) = value.get("coarse").and_then(|v| v.as_object()) else {
        return false;
    };
    if !matches!(
        coarse.get("sectionTitle"),
        Some(serde_json::Value::Null | serde_json::Value::String(_))
    ) {
        return false;
    }
    let quote_valid = match value.get("textQuote") {
        Some(serde_json::Value::Null) => true,
        Some(serde_json::Value::Object(quote)) => ["exact", "prefix", "suffix"]
            .iter()
            .all(|key| quote.get(*key).is_some_and(|v| v.is_string())),
        _ => false,
    };
    if !quote_valid {
        return false;
    }
    match value.get("engine").and_then(|v| v.as_str()) {
        Some("epub") => {
            primary.get("cfi").is_some_and(|v| v.is_string())
                && primary.get("spineIndex").and_then(|v| v.as_u64()).is_some()
                && primary.get("href").is_some_and(|v| v.is_string())
        }
        Some("pdf") => {
            let x = primary.get("x").and_then(|v| v.as_f64());
            let y = primary.get("y").and_then(|v| v.as_f64());
            primary.get("pageIndex").and_then(|v| v.as_u64()).is_some()
                && matches!(
                    primary.get("pageLabel"),
                    Some(serde_json::Value::Null | serde_json::Value::String(_))
                )
                && x.is_some_and(|value| (0.0..=1.0).contains(&value))
                && y.is_some_and(|value| (0.0..=1.0).contains(&value))
        }
        Some("text") => {
            primary.get("blockIndex").and_then(|v| v.as_u64()).is_some()
                && primary.get("charOffset").and_then(|v| v.as_u64()).is_some()
        }
        _ => false,
    }
}

fn valid_annotation_kind(kind: &str) -> bool {
    matches!(
        kind,
        "highlight"
            | "note"
            | "bookmark"
            | "quote"
            | "idea"
            | "question"
            | "vocabulary"
            | "action"
            | "character"
            | "free"
    )
}

fn find_book_by_identity(
    conn: &Connection,
    title: &str,
    exported_authors: &[String],
) -> Result<Option<String>, AppError> {
    let mut stmt = conn.prepare("SELECT id, authors FROM books WHERE title = ?1 ORDER BY id")?;
    let candidates = stmt
        .query_map([title], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let wanted_first = exported_authors.first().map(|a| a.trim()).unwrap_or("");
    for (id, authors_json) in candidates {
        let authors: Vec<String> = serde_json::from_str(&authors_json).unwrap_or_default();
        let actual_first = authors.first().map(|a| a.trim()).unwrap_or("");
        if wanted_first.is_empty() || actual_first.eq_ignore_ascii_case(wanted_first) {
            return Ok(Some(id));
        }
    }
    Ok(None)
}

fn existing_book_id(conn: &Connection, id: &str) -> Result<Option<String>, AppError> {
    Ok(conn
        .query_row("SELECT id FROM books WHERE id = ?1", [id], |r| r.get(0))
        .optional()?)
}

/// Import a validated export atomically. Entries are reconnected to books by
/// title and first author; legacy vocabulary is accepted only when its exact
/// original book ID still exists. Book files are never read or modified.
pub fn import_bundle(conn: &Connection, json: &str) -> Result<ImportReport, AppError> {
    let bundle: serde_json::Value = serde_json::from_str(json)
        .map_err(|_| AppError::Other("That file is not valid Lectorium export JSON.".into()))?;
    let version = bundle.get("version").and_then(|v| v.as_i64());
    if !matches!(version, Some(1 | 2)) {
        return Err(AppError::Other(
            "Unsupported export version. This file was made by a different Lectorium.".into(),
        ));
    }
    let entries = bundle
        .get("entries")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::Other("That export has no valid entries list.".into()))?;
    let vocabulary = bundle
        .get("vocabulary")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::Other("That export has no valid vocabulary list.".into()))?;

    // Validate the complete file before the first durable write.
    for entry in entries {
        let kind = entry.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let locator = entry
            .get("startLocatorJson")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let end_valid = entry
            .get("endLocatorJson")
            .and_then(|v| v.as_str())
            .map(valid_locator_json)
            .unwrap_or(true);
        if !valid_annotation_kind(kind) || !valid_locator_json(locator) || !end_valid {
            return Err(AppError::Other(
                "That export contains an invalid annotation or reading location.".into(),
            ));
        }
    }
    for entry in vocabulary {
        let word = entry
            .get("displayedWord")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let locator = entry
            .get("locatorJson")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if word.is_empty() || !valid_locator_json(locator) {
            return Err(AppError::Other(
                "That export contains an invalid vocabulary entry.".into(),
            ));
        }
    }

    let tx = conn.unchecked_transaction()?;
    let mut report = ImportReport {
        imported_entries: 0,
        imported_vocabulary: 0,
        skipped_no_book: 0,
        skipped_duplicate: 0,
    };
    let mut imported_ids = std::collections::HashMap::<String, String>::new();

    for entry in entries {
        let title = entry
            .get("bookTitle")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let authors: Vec<String> = entry
            .get("bookAuthors")
            .and_then(|v| v.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let Some(book_id) = find_book_by_identity(&tx, title, &authors)? else {
            report.skipped_no_book += 1;
            continue;
        };
        let old_id = entry.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let kind = entry.get("kind").and_then(|v| v.as_str()).unwrap_or("note");
        let locator = entry
            .get("startLocatorJson")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let quote = entry
            .get("exactQuote")
            .and_then(|v| v.as_str())
            .map(str::to_owned);
        let note = entry
            .get("note")
            .and_then(|v| v.as_str())
            .map(str::to_owned);
        let duplicate: Option<String> = tx
            .query_row(
                "SELECT id FROM annotations
                 WHERE book_id = ?1 AND kind = ?2 AND start_locator_json = ?3
                   AND exact_quote IS ?4 AND note IS ?5 LIMIT 1",
                params![book_id, kind, locator, quote, note],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(existing_id) = duplicate {
            if !old_id.is_empty() {
                imported_ids.insert(old_id.to_owned(), existing_id);
            }
            report.skipped_duplicate += 1;
            continue;
        }

        let new_id = uuid::Uuid::new_v4().to_string();
        let annotation = Annotation {
            id: new_id.clone(),
            book_id,
            kind: kind.to_owned(),
            start_locator_json: locator.to_owned(),
            end_locator_json: entry
                .get("endLocatorJson")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            exact_quote: quote,
            prefix: entry
                .get("prefix")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            suffix: entry
                .get("suffix")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            note,
            color_token: entry
                .get("colorToken")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            commonplace_heading: entry
                .get("commonplaceHeading")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            created_at: entry
                .get("createdAt")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
        };
        add_annotation(&tx, &annotation)?;
        if !old_id.is_empty() {
            imported_ids.insert(old_id.to_owned(), new_id);
        }
        report.imported_entries += 1;
    }

    // Rebuild connections only after every old annotation ID is mapped.
    for entry in entries {
        let Some(from) = entry
            .get("id")
            .and_then(|v| v.as_str())
            .and_then(|id| imported_ids.get(id))
        else {
            continue;
        };
        if let Some(linked) = entry.get("linkedIds").and_then(|v| v.as_array()) {
            for old_to in linked.iter().filter_map(|v| v.as_str()) {
                if let Some(to) = imported_ids.get(old_to) {
                    link_annotations(&tx, from, to)?;
                }
            }
        }
    }

    for entry in vocabulary {
        let word = entry
            .get("displayedWord")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let book_id = if version == Some(2) {
            let title = entry
                .get("bookTitle")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let authors: Vec<String> = entry
                .get("bookAuthors")
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|v| v.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default();
            find_book_by_identity(&tx, title, &authors)?
        } else {
            let original_book_id = entry.get("bookId").and_then(|v| v.as_str()).unwrap_or("");
            existing_book_id(&tx, original_book_id)?
        };
        let Some(book_id) = book_id else {
            report.skipped_no_book += 1;
            continue;
        };
        let normalized = entry
            .get("normalizedWord")
            .and_then(|v| v.as_str())
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| word.to_lowercase());
        let sentence = entry.get("sentence").and_then(|v| v.as_str()).unwrap_or("");
        let locator = entry
            .get("locatorJson")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let duplicate: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM vocabulary
             WHERE book_id = ?1 AND normalized_word = ?2 AND sentence = ?3
               AND locator_json = ?4)",
            params![book_id, normalized, sentence, locator],
            |r| r.get(0),
        )?;
        if duplicate {
            report.skipped_duplicate += 1;
            continue;
        }
        add_vocabulary(
            &tx,
            &VocabularyEntry {
                id: uuid::Uuid::new_v4().to_string(),
                book_id,
                normalized_word: normalized,
                displayed_word: word.to_owned(),
                sentence: sentence.to_owned(),
                definition: entry
                    .get("definition")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned),
                locator_json: locator.to_owned(),
                note: entry
                    .get("note")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned),
                created_at: entry
                    .get("createdAt")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned),
                book_title: None,
                book_authors: Vec::new(),
            },
        )?;
        report.imported_vocabulary += 1;
    }

    tx.commit()?;
    Ok(report)
}

pub fn set_reading_mode(conn: &Connection, book_id: &str, mode: &str) -> Result<(), AppError> {
    if !matches!(mode, "story" | "study" | "contemplative") {
        return Err(AppError::Other("Unknown reading mode.".into()));
    }
    conn.execute(
        "UPDATE books SET reading_mode = ?2 WHERE id = ?1",
        params![book_id, mode],
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn database(name: &str) -> (crate::db::Db, PathBuf) {
        let dir =
            std::env::temp_dir().join(format!("lectorium-repo-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (crate::db::open(&dir).unwrap(), dir)
    }

    fn locator(section: &str) -> String {
        serde_json::json!({
            "v": 1,
            "engine": "epub",
            "primary": { "cfi": "epubcfi(/6/2)", "spineIndex": 0, "href": "one.xhtml" },
            "textQuote": { "exact": "kept words", "prefix": "before ", "suffix": " after" },
            "coarse": { "sectionTitle": section, "spineIndex": 0 }
        })
        .to_string()
    }

    fn insert_book(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO books (id, canonical_path, source_format, reading_format, title, authors)
             VALUES (?1, ?2, 'epub', 'epub', 'Matched Book', '[\"Exact Author\"]')",
            params![id, format!("C:/{id}.epub")],
        )
        .unwrap();
    }

    #[test]
    fn export_import_roundtrip_preserves_sources_links_and_vocabulary_ownership() {
        let (source, source_dir) = database("export-source");
        let json = {
            let conn = source.conn.lock().unwrap();
            insert_book(&conn, "source-book");
            for (id, kind) in [("a1", "quote"), ("a2", "idea")] {
                add_annotation(
                    &conn,
                    &Annotation {
                        id: id.into(),
                        book_id: "source-book".into(),
                        kind: kind.into(),
                        start_locator_json: locator("Source Chapter"),
                        end_locator_json: Some(locator("Source Chapter")),
                        exact_quote: Some("kept words".into()),
                        prefix: Some("before ".into()),
                        suffix: Some(" after".into()),
                        note: Some(format!("note {id}")),
                        color_token: Some("selection".into()),
                        commonplace_heading: Some("craft".into()),
                        created_at: Some("2025-01-02T03:04:05.000Z".into()),
                    },
                )
                .unwrap();
            }
            link_annotations(&conn, "a1", "a2").unwrap();
            add_vocabulary(
                &conn,
                &VocabularyEntry {
                    id: "v1".into(),
                    book_id: "source-book".into(),
                    normalized_word: "word".into(),
                    displayed_word: "Word".into(),
                    sentence: "A sentence with Word.".into(),
                    definition: Some("A definition.".into()),
                    locator_json: locator("Source Chapter"),
                    note: Some("reader note".into()),
                    created_at: Some("2025-01-02T03:04:05.000Z".into()),
                    book_title: None,
                    book_authors: Vec::new(),
                },
            )
            .unwrap();
            let entries = list_commonplace(&conn, &CommonplaceQuery::default()).unwrap();
            assert!(entries
                .iter()
                .all(|entry| { entry.section_title.as_deref() == Some("Source Chapter") }));
            serde_json::to_string(&export_data(&conn).unwrap()).unwrap()
        };

        let (target, target_dir) = database("export-target");
        {
            let conn = target.conn.lock().unwrap();
            insert_book(&conn, "target-book");
            let report = import_bundle(&conn, &json).unwrap();
            assert_eq!(report.imported_entries, 2);
            assert_eq!(report.imported_vocabulary, 1);
            let preserved: (String, String, String, String) = conn
                .query_row(
                    "SELECT end_locator_json, prefix, suffix, created_at FROM annotations LIMIT 1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .unwrap();
            assert!(preserved.0.contains("Source Chapter"));
            assert_eq!(preserved.1, "before ");
            assert_eq!(preserved.2, " after");
            assert_eq!(preserved.3, "2025-01-02T03:04:05.000Z");
            let link_count: i64 = conn
                .query_row("SELECT count(*) FROM links", [], |r| r.get(0))
                .unwrap();
            assert_eq!(link_count, 1);
            let vocabulary_book: String = conn
                .query_row("SELECT book_id FROM vocabulary", [], |r| r.get(0))
                .unwrap();
            assert_eq!(vocabulary_book, "target-book");

            let repeated = import_bundle(&conn, &json).unwrap();
            assert_eq!(repeated.imported_entries, 0);
            assert_eq!(repeated.imported_vocabulary, 0);
            assert_eq!(repeated.skipped_duplicate, 3);
        }

        drop(source);
        drop(target);
        let _ = std::fs::remove_dir_all(source_dir);
        let _ = std::fs::remove_dir_all(target_dir);
    }

    #[test]
    fn malformed_import_is_rejected_before_any_write() {
        let (db, dir) = database("invalid-import");
        {
            let conn = db.conn.lock().unwrap();
            insert_book(&conn, "target-book");
            let invalid = serde_json::json!({
                "version": 2,
                "entries": [{
                    "id": "bad",
                    "bookTitle": "Matched Book",
                    "bookAuthors": ["Exact Author"],
                    "kind": "not-a-kind",
                    "startLocatorJson": locator("Chapter")
                }],
                "vocabulary": []
            })
            .to_string();
            assert!(import_bundle(&conn, &invalid).is_err());
            let count: i64 = conn
                .query_row("SELECT count(*) FROM annotations", [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 0);
        }
        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }
}
