//! The only place Lectorium opens an outbound connection.
//!
//! Two opt-in adapters use it — the Google Drive shelf and the reading
//! companion — and both run in Rust, so the WebView's CSP still allows no
//! remote origin at all. Every request here follows an explicit action by
//! the reader or a standing choice they made in Settings; there is no
//! telemetry, update ping, or background beacon (docs/SECURITY.md).

use std::io::Read;
use std::time::Duration;

#[derive(Debug)]
pub enum NetError {
    /// no route, DNS failure, timeout: the reader is probably offline
    Offline,
    /// the server answered with a non-success status
    Status { code: u16, body: String },
    /// a response we could not read or understand
    Malformed,
}

fn agent(timeout_secs: u64) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(12))
        .timeout(Duration::from_secs(timeout_secs))
        .user_agent("Lectorium (desktop reader)")
        .redirects(4)
        .build()
}

fn map_error(error: ureq::Error) -> NetError {
    match error {
        ureq::Error::Status(code, response) => {
            let mut body = String::new();
            let _ = response
                .into_reader()
                .take(64 * 1024)
                .read_to_string(&mut body);
            NetError::Status { code, body }
        }
        ureq::Error::Transport(_) => NetError::Offline,
    }
}

fn read_json(response: ureq::Response) -> Result<serde_json::Value, NetError> {
    let mut body = String::new();
    response
        .into_reader()
        .take(32 * 1024 * 1024)
        .read_to_string(&mut body)
        .map_err(|_| NetError::Malformed)?;
    serde_json::from_str(&body).map_err(|_| NetError::Malformed)
}

/// GET returning JSON. `headers` are (name, value) pairs.
pub fn get_json(url: &str, headers: &[(&str, &str)]) -> Result<serde_json::Value, NetError> {
    let mut request = agent(60).get(url);
    for (name, value) in headers {
        request = request.set(name, value);
    }
    read_json(request.call().map_err(map_error)?)
}

/// POST a JSON body, returning JSON.
pub fn post_json(
    url: &str,
    headers: &[(&str, &str)],
    body: &serde_json::Value,
    timeout_secs: u64,
) -> Result<serde_json::Value, NetError> {
    let mut request = agent(timeout_secs)
        .post(url)
        .set("Content-Type", "application/json");
    for (name, value) in headers {
        request = request.set(name, value);
    }
    read_json(request.send_string(&body.to_string()).map_err(map_error)?)
}

/// POST a form body (OAuth token endpoint), returning JSON.
pub fn post_form(url: &str, fields: &[(&str, &str)]) -> Result<serde_json::Value, NetError> {
    read_json(agent(60).post(url).send_form(fields).map_err(map_error)?)
}

/// GET a body as a stream, for downloads. The caller copies it to disk.
pub fn get_stream(
    url: &str,
    headers: &[(&str, &str)],
) -> Result<Box<dyn Read + Send + Sync + 'static>, NetError> {
    let mut request = agent(30 * 60).get(url);
    for (name, value) in headers {
        request = request.set(name, value);
    }
    Ok(request.call().map_err(map_error)?.into_reader())
}
