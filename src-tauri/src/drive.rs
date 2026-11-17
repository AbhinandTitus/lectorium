//! The Google Drive shelf: an opt-in, read-only mirror of one Drive folder.
//!
//! The reader connects their own Google account (OAuth for installed apps,
//! PKCE, loopback redirect) and names a folder. "Sync" lists that folder and
//! downloads the books in it into a folder inside Lectorium's own data
//! directory, which is then scanned like any other library folder. Reading
//! happens from the local copy, so everything keeps working offline.
//!
//! Boundaries (docs/SECURITY.md):
//! - scope is `drive.readonly`: Lectorium cannot change or delete anything
//!   in Drive, and never uploads;
//! - nothing is requested until the reader connects, and after that only
//!   when they press Sync or have turned on "check when Lectorium opens";
//! - the refresh token and client secret live in the OS credential vault;
//! - downloaded names are sanitized and can only land inside the shelf.

use crate::db::{repo, Db};
use crate::error::AppError;
use crate::net::{self, NetError};
use crate::secrets::{Secret, SecretStore};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const SCOPE: &str = "https://www.googleapis.com/auth/drive.readonly";
const KV_CONFIG: &str = "drive.config";
const FOLDER_MIME: &str = "application/vnd.google-apps.folder";
const MAX_DEPTH: usize = 4;
const MAX_FILES: usize = 2000;
/// refuse single files beyond this size; a book is never this large
const MAX_FILE_BYTES: i64 = 800 * 1024 * 1024;

/// Where Google's services live. Tests point these at a local server.
#[derive(Debug, Clone)]
pub struct Endpoints {
    pub auth: String,
    pub token: String,
    pub api: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Endpoints {
            auth: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token: "https://oauth2.googleapis.com/token".into(),
            api: "https://www.googleapis.com".into(),
        }
    }
}

/// Non-secret connector state, stored in `app_kv`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DriveConfig {
    pub client_id: String,
    /// what the reader typed: a folder name, a folder link, or a folder id
    pub folder: String,
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
    pub account: Option<String>,
    pub last_sync_at: Option<String>,
    /// standing choice: check the folder once each time Lectorium opens
    pub sync_on_launch: bool,
}

pub fn load_config(db: &Db) -> Result<DriveConfig, AppError> {
    let conn = lock(db)?;
    Ok(repo::kv_get(&conn, KV_CONFIG)?
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default())
}

pub fn save_config(db: &Db, config: &DriveConfig) -> Result<(), AppError> {
    let json = serde_json::to_string(config)
        .map_err(|_| AppError::Other("Could not save the Drive settings.".into()))?;
    let conn = lock(db)?;
    repo::kv_set(&conn, KV_CONFIG, &json)
}

fn lock(db: &Db) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, AppError> {
    db.conn
        .lock()
        .map_err(|_| AppError::Other("Lectorium's database is busy. Please try again.".into()))
}

/// Calm, specific copy for the things that can go wrong on the network.
pub fn explain(error: &NetError) -> AppError {
    let message = match error {
        NetError::Offline => {
            "Google Drive could not be reached. Check the connection and try again."
        }
        NetError::Status { code: 401, .. } => {
            "Google no longer accepts this sign-in. Connect Google Drive again in Settings."
        }
        NetError::Status { code: 403, body } if body.contains("accessNotConfigured") => {
            "The Google Drive API is not enabled for this Google Cloud project yet."
        }
        NetError::Status { code: 403, .. } => {
            "Google refused access to that folder. Check that this account can open it."
        }
        NetError::Status { code: 404, .. } => "That Drive folder could not be found.",
        NetError::Status { code: 429, .. } => {
            "Google Drive is asking Lectorium to slow down. Try again in a few minutes."
        }
        NetError::Status { .. } | NetError::Malformed => {
            "Google Drive returned something Lectorium could not use. Nothing was changed."
        }
    };
    AppError::Other(message.into())
}

// ---------- OAuth (installed app, PKCE, loopback) ----------

fn random_token(bytes: usize) -> Result<String, AppError> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|_| {
        AppError::Other("This computer could not produce a secure random value.".into())
    })?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf))
}

fn challenge_for(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// A sign-in in progress: the listener is already bound, so the redirect
/// cannot arrive before we are ready for it.
pub struct AuthSession {
    pub url: String,
    listener: TcpListener,
    redirect_uri: String,
    verifier: String,
    state: String,
}

pub fn begin_auth(endpoints: &Endpoints, client_id: &str) -> Result<AuthSession, AppError> {
    if client_id.trim().is_empty() {
        return Err(AppError::Other(
            "Add your Google OAuth client ID in Settings first.".into(),
        ));
    }
    // Loopback only: the redirect never leaves this computer.
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let verifier = random_token(48)?;
    let state = random_token(24)?;
    let mut url = url::Url::parse(&endpoints.auth)
        .map_err(|_| AppError::Other("The Google sign-in address is not valid.".into()))?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id.trim())
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", &challenge_for(&verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    Ok(AuthSession {
        url: url.into(),
        listener,
        redirect_uri,
        verifier,
        state,
    })
}

const AUTH_PAGE_OK: &str = "<!doctype html><meta charset=\"utf-8\"><title>Lectorium</title>\
<body style=\"background:#12100E;color:#C8BBA8;font-family:Georgia,serif;text-align:center;padding-top:18vh\">\
<h1 style=\"font-weight:400\">Google Drive is connected.</h1>\
<p>You can close this tab and return to Lectorium.</p></body>";
const AUTH_PAGE_FAILED: &str = "<!doctype html><meta charset=\"utf-8\"><title>Lectorium</title>\
<body style=\"background:#12100E;color:#C8BBA8;font-family:Georgia,serif;text-align:center;padding-top:18vh\">\
<h1 style=\"font-weight:400\">Google Drive was not connected.</h1>\
<p>Nothing was changed. You can close this tab and try again from Lectorium.</p></body>";

fn respond(stream: &mut std::net::TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

/// Wait for Google to redirect the browser back with an authorization code.
pub fn wait_for_code(session: &AuthSession, wait: Duration) -> Result<String, AppError> {
    session.listener.set_nonblocking(true)?;
    let deadline = Instant::now() + wait;
    loop {
        match session.listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false)?;
                stream.set_read_timeout(Some(Duration::from_secs(5)))?;
                let mut line = String::new();
                if BufReader::new(&stream).read_line(&mut line).is_err() {
                    continue;
                }
                // "GET /?code=...&state=... HTTP/1.1"
                let target = line.split_whitespace().nth(1).unwrap_or("/");
                let Ok(parsed) = url::Url::parse(&format!("http://127.0.0.1{target}")) else {
                    respond(&mut stream, "400 Bad Request", AUTH_PAGE_FAILED);
                    continue;
                };
                let mut code = None;
                let mut state = None;
                let mut denied = false;
                for (key, value) in parsed.query_pairs() {
                    match key.as_ref() {
                        "code" => code = Some(value.into_owned()),
                        "state" => state = Some(value.into_owned()),
                        "error" => denied = true,
                        _ => {}
                    }
                }
                if code.is_none() && !denied {
                    // a favicon request or a stray probe; keep waiting
                    respond(&mut stream, "404 Not Found", "");
                    continue;
                }
                if denied || state.as_deref() != Some(session.state.as_str()) {
                    respond(&mut stream, "200 OK", AUTH_PAGE_FAILED);
                    return Err(AppError::Other(
                        "Google Drive was not connected. Nothing was changed.".into(),
                    ));
                }
                respond(&mut stream, "200 OK", AUTH_PAGE_OK);
                return Ok(code.unwrap_or_default());
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(AppError::Other(
                        "The Google sign-in was not finished in time. Nothing was changed.".into(),
                    ));
                }
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(error) => return Err(error.into()),
        }
    }
}

/// Trade the authorization code for tokens; returns (access, refresh).
pub fn exchange_code(
    endpoints: &Endpoints,
    session: &AuthSession,
    client_id: &str,
    client_secret: Option<&str>,
    code: &str,
) -> Result<(String, String), AppError> {
    let mut fields = vec![
        ("client_id", client_id.trim()),
        ("code", code),
        ("code_verifier", session.verifier.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", session.redirect_uri.as_str()),
    ];
    if let Some(secret) = client_secret.filter(|s| !s.trim().is_empty()) {
        fields.push(("client_secret", secret.trim()));
    }
    let json = net::post_form(&endpoints.token, &fields).map_err(|e| match e {
        NetError::Status {
            code: 400 | 401, ..
        } => AppError::Other(
            "Google rejected the client ID or secret. Check them in Settings.".into(),
        ),
        other => explain(&other),
    })?;
    let access = json["access_token"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let refresh = json["refresh_token"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    if access.is_empty() || refresh.is_empty() {
        return Err(AppError::Other(
            "Google did not return a lasting sign-in. Try connecting again.".into(),
        ));
    }
    Ok((access, refresh))
}

/// A fresh access token from the stored refresh token.
pub fn access_token(
    endpoints: &Endpoints,
    config: &DriveConfig,
    secrets: &dyn SecretStore,
) -> Result<String, AppError> {
    let refresh = secrets.get(Secret::DriveRefreshToken)?.ok_or_else(|| {
        AppError::Other("Google Drive is not connected. Connect it in Settings.".into())
    })?;
    let client_secret = secrets.get(Secret::DriveClientCredential)?;
    let mut fields = vec![
        ("client_id", config.client_id.trim()),
        ("refresh_token", refresh.as_str()),
        ("grant_type", "refresh_token"),
    ];
    if let Some(secret) = client_secret.as_deref().filter(|s| !s.trim().is_empty()) {
        fields.push(("client_secret", secret.trim()));
    }
    let json = net::post_form(&endpoints.token, &fields).map_err(|e| match e {
        // an expired or revoked grant: the reader has to sign in again
        NetError::Status {
            code: 400 | 401, ..
        } => AppError::Other(
            "Google no longer accepts this sign-in. Connect Google Drive again in Settings.".into(),
        ),
        other => explain(&other),
    })?;
    json["access_token"]
        .as_str()
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .ok_or_else(|| explain(&NetError::Malformed))
}

// ---------- Drive API ----------

#[derive(Debug, Clone, PartialEq)]
pub struct RemoteFile {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: Option<i64>,
    pub md5: Option<String>,
    pub modified_time: Option<String>,
}

fn bearer(token: &str) -> String {
    format!("Bearer {token}")
}

fn api_get(
    endpoints: &Endpoints,
    token: &str,
    path: &str,
    query: &[(&str, &str)],
) -> Result<serde_json::Value, AppError> {
    let mut url = url::Url::parse(&format!("{}{path}", endpoints.api))
        .map_err(|_| explain(&NetError::Malformed))?;
    url.query_pairs_mut().extend_pairs(query);
    net::get_json(url.as_str(), &[("Authorization", &bearer(token))]).map_err(|e| explain(&e))
}

/// The signed-in account's address, for "Connected as …".
pub fn account_email(endpoints: &Endpoints, token: &str) -> Result<Option<String>, AppError> {
    let json = api_get(
        endpoints,
        token,
        "/drive/v3/about",
        &[("fields", "user(emailAddress)")],
    )?;
    Ok(json["user"]["emailAddress"].as_str().map(str::to_string))
}

/// What the reader meant by the folder field.
#[derive(Debug, PartialEq)]
pub enum FolderSpec {
    Id(String),
    Name(String),
}

pub fn parse_folder_spec(input: &str) -> FolderSpec {
    let trimmed = input.trim();
    if let Some(at) = trimmed.find("/folders/") {
        let id: String = trimmed[at + "/folders/".len()..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        if !id.is_empty() {
            return FolderSpec::Id(id);
        }
    }
    if let Some(at) = trimmed.find("id=") {
        if trimmed.starts_with("http") {
            let id: String = trimmed[at + 3..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if !id.is_empty() {
                return FolderSpec::Id(id);
            }
        }
    }
    let looks_like_id = trimmed.len() >= 25
        && !trimmed.contains(' ')
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if looks_like_id {
        FolderSpec::Id(trimmed.to_string())
    } else {
        FolderSpec::Name(trimmed.to_string())
    }
}

/// Resolve the folder field to (id, display name).
pub fn resolve_folder(
    endpoints: &Endpoints,
    token: &str,
    input: &str,
) -> Result<(String, String), AppError> {
    match parse_folder_spec(input) {
        FolderSpec::Id(id) => {
            let json = api_get(
                endpoints,
                token,
                &format!("/drive/v3/files/{id}"),
                &[
                    ("fields", "id,name,mimeType"),
                    ("supportsAllDrives", "true"),
                ],
            )?;
            if json["mimeType"].as_str() != Some(FOLDER_MIME) {
                return Err(AppError::Other("That Drive link is not a folder.".into()));
            }
            Ok((
                id,
                json["name"].as_str().unwrap_or("Drive folder").to_string(),
            ))
        }
        FolderSpec::Name(name) => {
            if name.is_empty() {
                return Err(AppError::Other(
                    "Name the Drive folder that holds your books.".into(),
                ));
            }
            let escaped = name.replace('\\', "\\\\").replace('\'', "\\'");
            let q =
                format!("name = '{escaped}' and mimeType = '{FOLDER_MIME}' and trashed = false");
            let json = api_get(
                endpoints,
                token,
                "/drive/v3/files",
                &[
                    ("q", q.as_str()),
                    ("fields", "files(id,name)"),
                    ("pageSize", "10"),
                    ("orderBy", "modifiedTime desc"),
                ],
            )?;
            let first = json["files"].as_array().and_then(|files| files.first());
            match first.and_then(|f| f["id"].as_str()) {
                Some(id) => Ok((id.to_string(), name)),
                None => Err(AppError::Other(format!(
                    "No folder named “{name}” was found in this Google Drive. Create it there, put your books in it, and sync again."
                ))),
            }
        }
    }
}

fn list_children(
    endpoints: &Endpoints,
    token: &str,
    folder_id: &str,
) -> Result<Vec<RemoteFile>, AppError> {
    let q = format!("'{folder_id}' in parents and trashed = false");
    let mut out = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let mut query = vec![
            ("q", q.as_str()),
            (
                "fields",
                "nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime)",
            ),
            ("pageSize", "200"),
            ("supportsAllDrives", "true"),
            ("includeItemsFromAllDrives", "true"),
        ];
        if let Some(token_value) = page_token.as_deref() {
            query.push(("pageToken", token_value));
        }
        let json = api_get(endpoints, token, "/drive/v3/files", &query)?;
        for file in json["files"].as_array().cloned().unwrap_or_default() {
            let Some(id) = file["id"].as_str() else {
                continue;
            };
            out.push(RemoteFile {
                id: id.to_string(),
                name: file["name"].as_str().unwrap_or("untitled").to_string(),
                mime_type: file["mimeType"].as_str().unwrap_or_default().to_string(),
                // Drive reports sizes as decimal strings
                size: file["size"].as_str().and_then(|s| s.parse().ok()),
                md5: file["md5Checksum"].as_str().map(str::to_string),
                modified_time: file["modifiedTime"].as_str().map(str::to_string),
            });
        }
        page_token = json["nextPageToken"].as_str().map(str::to_string);
        if page_token.is_none() || out.len() > MAX_FILES {
            break;
        }
    }
    Ok(out)
}

/// Every readable book in the folder and its subfolders.
pub fn list_books(
    endpoints: &Endpoints,
    token: &str,
    folder_id: &str,
) -> Result<Vec<RemoteFile>, AppError> {
    let mut books = Vec::new();
    let mut queue = vec![(folder_id.to_string(), 0usize)];
    while let Some((id, depth)) = queue.pop() {
        for file in list_children(endpoints, token, &id)? {
            if file.mime_type == FOLDER_MIME {
                if depth + 1 < MAX_DEPTH {
                    queue.push((file.id, depth + 1));
                }
                continue;
            }
            let readable = Path::new(&file.name)
                .extension()
                .and_then(|ext| ext.to_str())
                .and_then(crate::library::classify)
                .is_some();
            let size_ok = file.size.is_none_or(|bytes| bytes <= MAX_FILE_BYTES);
            if readable && size_ok {
                books.push(file);
            }
            if books.len() >= MAX_FILES {
                return Ok(books);
            }
        }
    }
    books.sort_by_key(|a| a.name.to_lowercase());
    Ok(books)
}

/// A file name that is safe to create on Windows and cannot leave its folder.
pub fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned
        .trim()
        .trim_end_matches(['.', ' '])
        .trim_start_matches('.');
    let (stem, ext) = match trimmed.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && ext.len() <= 8 => (stem, Some(ext)),
        _ => (trimmed, None),
    };
    let mut stem: String = stem.chars().take(140).collect();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if stem.is_empty() || reserved.contains(&stem.to_ascii_uppercase().as_str()) {
        stem = format!("book-{stem}");
    }
    match ext {
        Some(ext) => format!("{stem}.{ext}"),
        None => stem,
    }
}

/// Download one file into `dest` via a temporary sibling, so an interrupted
/// transfer never leaves a half-written book in the shelf.
fn download(
    endpoints: &Endpoints,
    token: &str,
    file_id: &str,
    dest: &Path,
) -> Result<(), AppError> {
    let url = format!(
        "{}/drive/v3/files/{file_id}?alt=media&supportsAllDrives=true",
        endpoints.api
    );
    let mut reader =
        net::get_stream(&url, &[("Authorization", &bearer(token))]).map_err(|e| explain(&e))?;
    let partial = dest.with_extension(format!(
        "{}.part",
        dest.extension().and_then(|e| e.to_str()).unwrap_or("bin")
    ));
    let result = (|| -> Result<(), AppError> {
        let mut file = std::fs::File::create(&partial)?;
        let mut limited = (&mut reader).take(MAX_FILE_BYTES as u64 + 1);
        let copied = std::io::copy(&mut limited, &mut file)?;
        if copied > MAX_FILE_BYTES as u64 {
            return Err(AppError::Other(
                "A file in Drive was too large to keep.".into(),
            ));
        }
        file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = std::fs::remove_file(&partial);
        return Err(error);
    }
    if dest.exists() {
        std::fs::remove_file(dest)?;
    }
    std::fs::rename(&partial, dest)?;
    Ok(())
}

// ---------- sync ----------

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum SyncEvent {
    Listing,
    #[serde(rename_all = "camelCase")]
    Downloading {
        done: usize,
        total: usize,
        name: String,
    },
    #[serde(rename_all = "camelCase")]
    Done {
        downloaded: usize,
        total: usize,
        no_longer_in_drive: usize,
        failed: usize,
    },
    Failed {
        message: String,
    },
}

#[derive(Debug, Default, PartialEq)]
pub struct SyncOutcome {
    pub downloaded: usize,
    pub total: usize,
    pub no_longer_in_drive: usize,
    pub failed: usize,
}

/// Pick the local path for a remote file: the path it already has, else a
/// sanitized name that no other Drive file is using.
fn local_path_for(
    conn: &rusqlite::Connection,
    shelf: &Path,
    file: &RemoteFile,
) -> Result<PathBuf, AppError> {
    if let Some(row) = repo::drive_file(conn, &file.id)? {
        let existing = PathBuf::from(&row.local_path);
        if existing.parent() == Some(shelf) {
            return Ok(existing);
        }
    }
    let base = safe_file_name(&file.name);
    let (stem, ext) = match base.rsplit_once('.') {
        Some((stem, ext)) => (stem.to_string(), format!(".{ext}")),
        None => (base.clone(), String::new()),
    };
    for n in 1..500 {
        let candidate = if n == 1 {
            shelf.join(&base)
        } else {
            shelf.join(format!("{stem} ({n}){ext}"))
        };
        let owner = repo::drive_path_owner(conn, &candidate.to_string_lossy())?;
        match owner {
            Some(owner) if owner != file.id => continue,
            Some(_) => return Ok(candidate),
            // a file we did not put there is not ours to overwrite
            None if candidate.exists() => continue,
            None => return Ok(candidate),
        }
    }
    Err(AppError::Other(
        "Too many files in Drive share the same name.".into(),
    ))
}

/// Mirror the configured folder into `shelf`. Testable: no Tauri types.
pub fn run_sync(
    db: &Db,
    secrets: &dyn SecretStore,
    endpoints: &Endpoints,
    shelf: &Path,
    on_event: &mut dyn FnMut(SyncEvent),
) -> Result<SyncOutcome, AppError> {
    let mut config = load_config(db)?;
    std::fs::create_dir_all(shelf)?;
    let shelf = std::fs::canonicalize(shelf)?;
    on_event(SyncEvent::Listing);

    let token = access_token(endpoints, &config, secrets)?;
    let (folder_id, folder_name) = resolve_folder(endpoints, &token, &config.folder)?;
    let remote = list_books(endpoints, &token, &folder_id)?;

    let mut outcome = SyncOutcome {
        total: remote.len(),
        ..SyncOutcome::default()
    };
    let mut pending = Vec::new();
    {
        let conn = lock(db)?;
        for file in &remote {
            let dest = local_path_for(&conn, &shelf, file)?;
            let row = repo::drive_file(&conn, &file.id)?;
            let unchanged = row.as_ref().is_some_and(|row| {
                row.md5.is_some() && row.md5 == file.md5 && Path::new(&row.local_path).is_file()
            });
            if !unchanged {
                // reserve the path now so two same-named files cannot collide
                repo::drive_upsert_file(
                    &conn,
                    &file.id,
                    &file.name,
                    None,
                    file.modified_time.as_deref(),
                    file.size,
                    &dest.to_string_lossy(),
                )?;
                pending.push((file.clone(), dest));
            }
        }
    }

    let total = pending.len();
    for (done, (file, dest)) in pending.into_iter().enumerate() {
        on_event(SyncEvent::Downloading {
            done,
            total,
            name: file.name.clone(),
        });
        // the destination is always a direct child of the shelf
        if dest.parent() != Some(shelf.as_path()) {
            outcome.failed += 1;
            continue;
        }
        match download(endpoints, &token, &file.id, &dest) {
            Ok(()) => {
                let conn = lock(db)?;
                repo::drive_upsert_file(
                    &conn,
                    &file.id,
                    &file.name,
                    file.md5.as_deref(),
                    file.modified_time.as_deref(),
                    file.size,
                    &dest.to_string_lossy(),
                )?;
                outcome.downloaded += 1;
            }
            Err(error) => {
                tracing::warn!(?error, name = %file.name, "drive download failed");
                outcome.failed += 1;
            }
        }
    }

    {
        let conn = lock(db)?;
        let present: Vec<String> = remote.iter().map(|f| f.id.clone()).collect();
        outcome.no_longer_in_drive = repo::drive_mark_absent(&conn, &present)?;
    }

    config.folder_id = Some(folder_id);
    config.folder_name = Some(folder_name);
    config.last_sync_at = Some(now_iso(db)?);
    save_config(db, &config)?;

    on_event(SyncEvent::Done {
        downloaded: outcome.downloaded,
        total: outcome.total,
        no_longer_in_drive: outcome.no_longer_in_drive,
        failed: outcome.failed,
    });
    Ok(outcome)
}

fn now_iso(db: &Db) -> Result<String, AppError> {
    let conn = lock(db)?;
    Ok(
        conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |r| {
            r.get(0)
        })?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemoryStore;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    #[test]
    fn folder_field_accepts_names_links_and_ids() {
        assert_eq!(
            parse_folder_spec("  Lectorium "),
            FolderSpec::Name("Lectorium".into())
        );
        assert_eq!(
            parse_folder_spec(
                "https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345?usp=sharing"
            ),
            FolderSpec::Id("1AbCdEfGhIjKlMnOpQrStUvWxYz012345".into())
        );
        assert_eq!(
            parse_folder_spec("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345"),
            FolderSpec::Id("1AbCdEfGhIjKlMnOpQrStUvWxYz012345".into())
        );
        assert_eq!(
            parse_folder_spec("1AbCdEfGhIjKlMnOpQrStUvWxYz012345"),
            FolderSpec::Id("1AbCdEfGhIjKlMnOpQrStUvWxYz012345".into())
        );
        // a long title with spaces is still a name
        assert_eq!(
            parse_folder_spec("Books I mean to read this winter"),
            FolderSpec::Name("Books I mean to read this winter".into())
        );
    }

    #[test]
    fn file_names_cannot_escape_or_break_windows() {
        assert_eq!(
            safe_file_name("../../etc/passwd.epub"),
            "_.._etc_passwd.epub"
        );
        assert_eq!(safe_file_name("a:b*c?.pdf"), "a_b_c_.pdf");
        assert_eq!(safe_file_name("CON.epub"), "book-CON.epub");
        assert_eq!(safe_file_name("trailing dot. "), "trailing dot");
        assert_eq!(safe_file_name("..hidden.epub"), "hidden.epub");
        // Malayalam survives untouched
        assert_eq!(safe_file_name("ശാന്തമായ രീതി.epub"), "ശാന്തമായ രീതി.epub");
        assert!(!safe_file_name("x/y\\z.epub").contains(['/', '\\']));
    }

    #[test]
    fn pkce_challenge_matches_rfc_7636_example() {
        // RFC 7636 appendix B
        assert_eq!(
            challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    // ---- a small scripted HTTP server standing in for Google ----

    #[derive(Default)]
    struct Fake {
        /// file id -> bytes served for alt=media
        content: HashMap<String, Vec<u8>>,
        /// JSON body for the root folder listing, by page token ("" = first)
        root_pages: HashMap<String, String>,
        sub_listing: String,
        requests: Vec<String>,
    }

    fn serve(fake: Arc<Mutex<Fake>>) -> Endpoints {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request_line = String::new();
                if reader.read_line(&mut request_line).is_err() {
                    continue;
                }
                let mut length = 0usize;
                loop {
                    let mut header = String::new();
                    if reader.read_line(&mut header).is_err() || header.trim().is_empty() {
                        break;
                    }
                    if let Some(value) = header.to_ascii_lowercase().strip_prefix("content-length:")
                    {
                        length = value.trim().parse().unwrap_or(0);
                    }
                }
                let mut body = vec![0u8; length];
                let _ = reader.read_exact(&mut body);
                let target = request_line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("/")
                    .to_string();
                let url = url::Url::parse(&format!("http://x{target}")).unwrap();
                let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
                let mut fake = fake.lock().unwrap();
                fake.requests.push(target.clone());
                let (status, content_type, payload): (&str, &str, Vec<u8>) = if url.path()
                    == "/token"
                {
                    (
                        "200 OK",
                        "application/json",
                        br#"{"access_token":"access-1","expires_in":3600}"#.to_vec(),
                    )
                } else if url.path() == "/drive/v3/files" {
                    let q = query.get("q").cloned().unwrap_or_default();
                    let json = if q.starts_with("name = ") {
                        r#"{"files":[{"id":"root-folder","name":"Lectorium"}]}"#.to_string()
                    } else if q.starts_with("'root-folder'") {
                        let page = query.get("pageToken").cloned().unwrap_or_default();
                        fake.root_pages
                            .get(&page)
                            .cloned()
                            .unwrap_or_else(|| r#"{"files":[]}"#.into())
                    } else if q.starts_with("'sub-folder'") {
                        fake.sub_listing.clone()
                    } else {
                        r#"{"files":[]}"#.to_string()
                    };
                    ("200 OK", "application/json", json.into_bytes())
                } else if let Some(id) = url.path().strip_prefix("/drive/v3/files/") {
                    match fake.content.get(id) {
                        Some(bytes) if query.get("alt").map(String::as_str) == Some("media") => {
                            ("200 OK", "application/octet-stream", bytes.clone())
                        }
                        _ => ("404 Not Found", "application/json", b"{}".to_vec()),
                    }
                } else {
                    ("404 Not Found", "application/json", b"{}".to_vec())
                };
                drop(fake);
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    payload.len()
                );
                let _ = stream.write_all(&payload);
            }
        });
        Endpoints {
            auth: format!("{base}/auth"),
            token: format!("{base}/token"),
            api: base,
        }
    }

    fn setup(name: &str) -> (Db, PathBuf, MemoryStore) {
        let dir =
            std::env::temp_dir().join(format!("lectorium-drive-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let db = crate::db::open(&dir).unwrap();
        let secrets = MemoryStore::default();
        secrets.set(Secret::DriveRefreshToken, "refresh-1").unwrap();
        save_config(
            &db,
            &DriveConfig {
                client_id: "client".into(),
                folder: "Lectorium".into(),
                ..DriveConfig::default()
            },
        )
        .unwrap();
        (db, dir, secrets)
    }

    #[test]
    fn sync_mirrors_books_then_only_fetches_what_changed() {
        let (db, dir, secrets) = setup("mirror");
        let shelf = dir.join("drive-shelf");
        let fake = Arc::new(Mutex::new(Fake::default()));
        {
            let mut f = fake.lock().unwrap();
            f.root_pages.insert(
                "".into(),
                r#"{"nextPageToken":"p2","files":[
                    {"id":"f1","name":"One.epub","mimeType":"application/epub+zip","size":"3","md5Checksum":"m1"},
                    {"id":"doc","name":"Notes","mimeType":"application/vnd.google-apps.document"},
                    {"id":"img","name":"cover.jpg","mimeType":"image/jpeg","size":"9","md5Checksum":"mi"}
                ]}"#
                .into(),
            );
            f.root_pages.insert(
                "p2".into(),
                r#"{"files":[
                    {"id":"f2","name":"Two: A/B.pdf","mimeType":"application/pdf","size":"3","md5Checksum":"m2"},
                    {"id":"sub-folder","name":"More","mimeType":"application/vnd.google-apps.folder"}
                ]}"#
                .into(),
            );
            f.sub_listing = r#"{"files":[
                {"id":"f3","name":"One.epub","mimeType":"application/epub+zip","size":"5","md5Checksum":"m3"}
            ]}"#
            .into();
            f.content.insert("f1".into(), b"one".to_vec());
            f.content.insert("f2".into(), b"two".to_vec());
            f.content.insert("f3".into(), b"three".to_vec());
        }
        let endpoints = serve(fake.clone());

        let mut events = Vec::new();
        let first = run_sync(&db, &secrets, &endpoints, &shelf, &mut |e| events.push(e)).unwrap();
        assert_eq!(
            first,
            SyncOutcome {
                downloaded: 3,
                total: 3,
                no_longer_in_drive: 0,
                failed: 0
            }
        );
        assert_eq!(std::fs::read(shelf.join("One.epub")).unwrap(), b"one");
        // unsafe characters are replaced; the file stays inside the shelf
        assert_eq!(std::fs::read(shelf.join("Two_ A_B.pdf")).unwrap(), b"two");
        // a second file with the same name gets its own path
        assert_eq!(std::fs::read(shelf.join("One (2).epub")).unwrap(), b"three");
        assert!(!shelf.join("cover.jpg").exists());
        assert!(matches!(
            events.last(),
            Some(SyncEvent::Done { downloaded: 3, .. })
        ));
        let config = load_config(&db).unwrap();
        assert_eq!(config.folder_id.as_deref(), Some("root-folder"));
        assert!(config.last_sync_at.is_some());

        // nothing changed: nothing is downloaded again
        fake.lock().unwrap().requests.clear();
        let second = run_sync(&db, &secrets, &endpoints, &shelf, &mut |_| {}).unwrap();
        assert_eq!(second.downloaded, 0);
        assert!(!fake
            .lock()
            .unwrap()
            .requests
            .iter()
            .any(|r| r.contains("alt=media")));

        // one file changes in Drive, one disappears from the folder
        {
            let mut f = fake.lock().unwrap();
            f.root_pages.insert(
                "".into(),
                r#"{"files":[
                    {"id":"f1","name":"One.epub","mimeType":"application/epub+zip","size":"7","md5Checksum":"m1-new"}
                ]}"#
                .into(),
            );
            f.root_pages.remove("p2");
            f.content.insert("f1".into(), b"one-new".to_vec());
        }
        let third = run_sync(&db, &secrets, &endpoints, &shelf, &mut |_| {}).unwrap();
        assert_eq!(third.downloaded, 1);
        assert_eq!(third.no_longer_in_drive, 2);
        assert_eq!(std::fs::read(shelf.join("One.epub")).unwrap(), b"one-new");
        // files gone from Drive stay on this computer
        assert!(shelf.join("Two_ A_B.pdf").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sync_without_a_sign_in_explains_itself() {
        let (db, dir, secrets) = setup("signedout");
        secrets.delete(Secret::DriveRefreshToken).unwrap();
        let error = run_sync(
            &db,
            &secrets,
            &Endpoints::default(),
            &dir.join("drive-shelf"),
            &mut |_| {},
        )
        .unwrap_err();
        assert!(error.to_string().contains("not connected"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn loopback_redirect_returns_the_code_and_rejects_a_wrong_state() {
        let endpoints = Endpoints::default();
        let session = begin_auth(&endpoints, "client-id").unwrap();
        assert!(session.url.contains("code_challenge_method=S256"));
        assert!(session.url.contains("drive.readonly"));
        let redirect = session.redirect_uri.clone();
        let state = session.state.clone();
        let sender = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            let _ = net::get_json(&format!("{redirect}/favicon.ico"), &[]);
            let _ = net::get_json(&format!("{redirect}/?code=abc123&state={state}"), &[]);
        });
        assert_eq!(
            wait_for_code(&session, Duration::from_secs(10)).unwrap(),
            "abc123"
        );
        sender.join().unwrap();

        let session = begin_auth(&endpoints, "client-id").unwrap();
        let redirect = session.redirect_uri.clone();
        let sender = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            let _ = net::get_json(&format!("{redirect}/?code=abc123&state=forged"), &[]);
        });
        assert!(wait_for_code(&session, Duration::from_secs(10)).is_err());
        sender.join().unwrap();
    }
}
