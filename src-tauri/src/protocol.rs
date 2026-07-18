//! The `book://` protocol: the only route by which publication bytes reach
//! the WebView (ADR 0005). Opaque book ids resolve to canonical paths via
//! the database; every resolved path is scope-checked against the granted
//! library roots (or the app cover cache) before a single byte is served.
//! Range requests are honored so large PDFs stream instead of loading whole.

use crate::db::Db;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, UriSchemeContext};

const MAX_CHUNK: u64 = 8 * 1024 * 1024; // cap a single range response at 8 MiB

pub fn handle(
    ctx: UriSchemeContext<'_, tauri::Wry>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let app = ctx.app_handle();
    match serve(app, &request) {
        Ok(resp) => resp,
        Err(status) => Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, "text/plain")
            .body(Vec::new())
            .unwrap_or_default(),
    }
}

fn serve(app: &AppHandle, request: &Request<Vec<u8>>) -> Result<Response<Vec<u8>>, StatusCode> {
    // The WebView page origin (localhost:1420 in dev, tauri.localhost in
    // prod) differs from book.localhost, so responses need CORS headers.
    // Only our own WebView can reach this scheme; path scoping below is the
    // real security boundary.
    if request.method() == tauri::http::Method::OPTIONS {
        return Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range, Content-Type")
            .body(Vec::new())
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
    }

    let path = request.uri().path();
    let mut segments = path.trim_start_matches('/').splitn(2, '/');
    let kind = segments.next().unwrap_or_default();
    let id = segments.next().unwrap_or_default();
    if id.is_empty() || id.contains(['/', '\\', '.']) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let db = app.state::<Db>();
    let (file_path, content_type) = match kind {
        "file" => {
            let conn = db
                .conn
                .lock()
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let (p, fmt): (String, String) = conn
                .query_row(
                    "SELECT canonical_path, source_format FROM books WHERE id = ?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|_| StatusCode::NOT_FOUND)?;
            let roots: Vec<String> = {
                let mut stmt = conn
                    .prepare("SELECT canonical_path FROM library_roots")
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                let collected: Vec<String> = stmt
                    .query_map([], |r| r.get(0))
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
                    .filter_map(|r| r.ok())
                    .collect();
                collected
            };
            drop(conn);
            let canonical = canonicalize_checked(&p, |c| {
                roots
                    .iter()
                    .any(|root| starts_with_path(c, Path::new(root)))
            })?;
            (canonical, content_type_for(&fmt))
        }
        "cover" => {
            let conn = db
                .conn
                .lock()
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let p: Option<String> = conn
                .query_row(
                    "SELECT cover_cache_path FROM books WHERE id = ?1",
                    [id],
                    |r| r.get(0),
                )
                .map_err(|_| StatusCode::NOT_FOUND)?;
            drop(conn);
            let p = p.ok_or(StatusCode::NOT_FOUND)?;
            let covers_dir = app
                .path()
                .app_cache_dir()
                .map(|d| d.join("covers"))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let canonical = canonicalize_checked(&p, |c| starts_with_path(c, &covers_dir))?;
            let ct = match canonical.extension().and_then(|e| e.to_str()) {
                Some("png") => "image/png",
                Some("gif") => "image/gif",
                Some("webp") => "image/webp",
                _ => "image/jpeg",
            };
            (canonical, ct)
        }
        _ => return Err(StatusCode::NOT_FOUND),
    };

    let mut file = std::fs::File::open(&file_path).map_err(|_| StatusCode::NOT_FOUND)?;
    let total = file
        .metadata()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .len();

    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| parse_range(v, total));

    let builder = Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Range, Accept-Ranges, Content-Length",
        );

    match range {
        Some((start, end)) => {
            let len = end - start + 1;
            let mut buf = vec![0u8; len as usize];
            file.seek(SeekFrom::Start(start))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            file.read_exact(&mut buf)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            builder
                .status(StatusCode::PARTIAL_CONTENT)
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes {start}-{end}/{total}"),
                )
                .header(header::CONTENT_LENGTH, len.to_string())
                .body(buf)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        }
        None => {
            let mut buf = Vec::with_capacity(total.min(MAX_CHUNK) as usize);
            file.read_to_end(&mut buf)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            builder
                .status(StatusCode::OK)
                .header(header::CONTENT_LENGTH, buf.len().to_string())
                .body(buf)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

fn content_type_for(source_format: &str) -> &'static str {
    match source_format {
        "epub" => "application/epub+zip",
        "pdf" => "application/pdf",
        "md" => "text/markdown; charset=utf-8",
        "html" => "text/html; charset=utf-8",
        _ => "text/plain; charset=utf-8",
    }
}

fn canonicalize_checked(
    raw: &str,
    in_scope: impl Fn(&Path) -> bool,
) -> Result<PathBuf, StatusCode> {
    let canonical = std::fs::canonicalize(raw).map_err(|_| StatusCode::NOT_FOUND)?;
    if in_scope(&canonical) {
        Ok(canonical)
    } else {
        tracing::warn!(?canonical, "blocked out-of-scope file request");
        Err(StatusCode::FORBIDDEN)
    }
}

/// Windows canonical paths carry a `\\?\` prefix; compare component-wise
/// after canonicalizing both sides where possible.
fn starts_with_path(candidate: &Path, base: &Path) -> bool {
    let base = std::fs::canonicalize(base).unwrap_or_else(|_| base.to_path_buf());
    candidate.starts_with(&base)
}

/// Parse a single `bytes=start-end` range. Multi-range requests are refused
/// (treated as full-file) for simplicity.
fn parse_range(value: &str, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return None;
    }
    let spec = value.strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (start_s, end_s) = spec.split_once('-')?;
    if start_s.is_empty() {
        // suffix range: last N bytes
        let n: u64 = end_s.parse().ok()?;
        if n == 0 {
            return None;
        }
        let start = total.saturating_sub(n);
        return Some((start, total - 1));
    }
    let start: u64 = start_s.parse().ok()?;
    if start >= total {
        return None;
    }
    let end = if end_s.is_empty() {
        (start + MAX_CHUNK - 1).min(total - 1)
    } else {
        end_s.parse::<u64>().ok()?.min(total - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end.min(start + MAX_CHUNK - 1)))
}

#[cfg(test)]
mod tests {
    use super::parse_range;

    #[test]
    fn parses_standard_and_suffix_ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
    }

    #[test]
    fn rejects_invalid_ranges() {
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=5-2", 1000), None);
        assert_eq!(parse_range("bytes=0-1,5-9", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
        assert_eq!(parse_range("bytes=0-99", 0), None);
    }
}
