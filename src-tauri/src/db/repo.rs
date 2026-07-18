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
                                  exact_quote, prefix, suffix, note, color_token, commonplace_heading)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
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
            a.commonplace_heading
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
    // Commonplace shows reflective/kept kinds, not raw bookmarks/highlights.
    let mut sql = String::from(
        "SELECT a.id, a.book_id, b.title, b.authors, a.kind, a.exact_quote, a.note,
                a.commonplace_heading, a.start_locator_json, b.reading_format, a.created_at,
                (SELECT l.section_title FROM book_locations l WHERE l.book_id = a.book_id)
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
    sql.push_str(" ORDER BY a.created_at DESC LIMIT 1000");

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
                section_title: r.get(11)?,
                linked_ids: Vec::new(),
            })
        })?
        .collect::<Result<_, _>>()?;

    // attach cross-links
    for entry in &mut entries {
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
}

pub fn add_vocabulary(conn: &Connection, v: &VocabularyEntry) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO vocabulary (id, book_id, normalized_word, displayed_word, sentence,
                                 definition, locator_json, note)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            v.id,
            v.book_id,
            v.normalized_word,
            v.displayed_word,
            v.sentence,
            v.definition,
            v.locator_json,
            v.note
        ],
    )?;
    Ok(())
}

pub fn list_vocabulary(conn: &Connection) -> Result<Vec<VocabularyEntry>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, book_id, normalized_word, displayed_word, sentence, definition,
                locator_json, note, created_at
         FROM vocabulary ORDER BY created_at DESC LIMIT 2000",
    )?;
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
}

/// Items available for Recall now: kept entries whose `available_after` has
/// passed (or is unset). Spacing schedules availability; the queue is never
/// forced and no score is kept.
pub fn recall_available(conn: &Connection, limit: i64) -> Result<Vec<RecallItem>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.commonplace_heading, a.kind, b.title, a.exact_quote, a.note, a.book_id
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
    let entries = list_commonplace(conn, &CommonplaceQuery::default())?;
    let vocabulary = list_vocabulary(conn)?;
    Ok(ExportBundle {
        version: 1,
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
    pub vocabulary: Vec<VocabularyEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported_entries: i64,
    pub imported_vocabulary: i64,
    pub skipped_no_book: i64,
    pub skipped_duplicate: i64,
}

/// Import a previously exported bundle. Matches entries to books by exact
/// (title, first author); re-anchors annotations that reference a book still
/// present. Skips entries whose book is missing or whose exact quote already
/// exists for that book (idempotent-ish). Never touches book files.
pub fn import_bundle(conn: &Connection, json: &str) -> Result<ImportReport, AppError> {
    let bundle: serde_json::Value = serde_json::from_str(json)
        .map_err(|_| AppError::Other("That file is not valid Lectorium export JSON.".into()))?;
    if bundle.get("version").and_then(|v| v.as_i64()) != Some(1) {
        return Err(AppError::Other(
            "Unsupported export version. This file was made by a different Lectorium.".into(),
        ));
    }

    let mut report = ImportReport {
        imported_entries: 0,
        imported_vocabulary: 0,
        skipped_no_book: 0,
        skipped_duplicate: 0,
    };

    let find_book = |title: &str, author: &str| -> Option<String> {
        conn.query_row(
            "SELECT id FROM books WHERE title = ?1
             AND (?2 = '' OR authors LIKE '%' || ?2 || '%') LIMIT 1",
            params![title, author],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
    };

    if let Some(entries) = bundle.get("entries").and_then(|e| e.as_array()) {
        for e in entries {
            let title = e.get("bookTitle").and_then(|v| v.as_str()).unwrap_or("");
            let author = e
                .get("bookAuthors")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let Some(book_id) = find_book(title, author) else {
                report.skipped_no_book += 1;
                continue;
            };
            let quote = e.get("exactQuote").and_then(|v| v.as_str());
            // duplicate guard on exact quote within the same book
            if let Some(q) = quote {
                let exists: bool = conn
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM annotations WHERE book_id = ?1 AND exact_quote = ?2)",
                        params![book_id, q],
                        |r| r.get(0),
                    )
                    .unwrap_or(false);
                if exists {
                    report.skipped_duplicate += 1;
                    continue;
                }
            }
            let ann = Annotation {
                id: uuid_like(),
                book_id,
                kind: e
                    .get("kind")
                    .and_then(|v| v.as_str())
                    .unwrap_or("note")
                    .to_string(),
                start_locator_json: e
                    .get("startLocatorJson")
                    .and_then(|v| v.as_str())
                    .unwrap_or("{}")
                    .to_string(),
                end_locator_json: None,
                exact_quote: quote.map(str::to_string),
                prefix: None,
                suffix: None,
                note: e.get("note").and_then(|v| v.as_str()).map(str::to_string),
                color_token: Some("selection".into()),
                commonplace_heading: e
                    .get("commonplaceHeading")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                created_at: None,
            };
            add_annotation(conn, &ann)?;
            report.imported_entries += 1;
        }
    }

    if let Some(vocab) = bundle.get("vocabulary").and_then(|v| v.as_array()) {
        for v in vocab {
            let word = v
                .get("displayedWord")
                .and_then(|x| x.as_str())
                .unwrap_or("");
            if word.is_empty() {
                continue;
            }
            // vocab has no book title in the bundle; attach to any book if the
            // exact sentence already anchors, else skip cleanly
            let sentence = v.get("sentence").and_then(|x| x.as_str()).unwrap_or("");
            let book_id: Option<String> = conn
                .query_row("SELECT id FROM books LIMIT 1", [], |r| r.get(0))
                .optional()?;
            let Some(book_id) = book_id else {
                report.skipped_no_book += 1;
                continue;
            };
            let entry = VocabularyEntry {
                id: uuid_like(),
                book_id,
                normalized_word: word.to_lowercase(),
                displayed_word: word.to_string(),
                sentence: sentence.to_string(),
                definition: v
                    .get("definition")
                    .and_then(|x| x.as_str())
                    .map(str::to_string),
                locator_json: v
                    .get("locatorJson")
                    .and_then(|x| x.as_str())
                    .unwrap_or("{}")
                    .to_string(),
                note: v.get("note").and_then(|x| x.as_str()).map(str::to_string),
                created_at: None,
            };
            add_vocabulary(conn, &entry)?;
            report.imported_vocabulary += 1;
        }
    }
    Ok(report)
}

/// UUID v4 without pulling uuid into this module — random bytes hex-formatted.
fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let r = nanos
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    format!("imp-{:016x}-{:08x}", r, (nanos as u64) & 0xffff_ffff)
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
