//! A tiny scripted HTTP server for tests: stands in for Google's services
//! so network adapters can be exercised without leaving this machine.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;

pub struct Request {
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<String> {
        self.headers.get(&name.to_ascii_lowercase()).cloned()
    }
}

pub struct Reply {
    status: u16,
    body: String,
}

impl Reply {
    pub fn json(status: u16, body: &str) -> Reply {
        Reply {
            status,
            body: body.to_string(),
        }
    }
}

/// Serve every request with `handler`; returns the base URL.
pub fn serve<F>(handler: F) -> String
where
    F: Fn(&Request) -> Reply + Send + 'static,
{
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let Ok(clone) = stream.try_clone() else {
                continue;
            };
            let mut reader = BufReader::new(clone);
            let mut request_line = String::new();
            if reader.read_line(&mut request_line).is_err() {
                continue;
            }
            let mut headers = HashMap::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
                    break;
                }
                if let Some((name, value)) = line.split_once(':') {
                    headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
                }
            }
            let length = headers
                .get("content-length")
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(0);
            let mut body = vec![0u8; length];
            let _ = reader.read_exact(&mut body);
            let request = Request {
                path: request_line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("/")
                    .to_string(),
                headers,
                body: String::from_utf8_lossy(&body).into_owned(),
            };
            let reply = handler(&request);
            let reason = if reply.status < 400 { "OK" } else { "Error" };
            let _ = write!(
                stream,
                "HTTP/1.1 {} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                reply.status,
                reply.body.len(),
                reply.body
            );
        }
    });
    base
}
