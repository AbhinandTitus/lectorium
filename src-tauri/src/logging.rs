//! Local file logging. Rotating daily files in the app log dir; nothing
//! ever leaves the machine. Raw diagnostics live here, not in the UI.

use std::path::Path;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub fn init(log_dir: &Path) -> Option<WorkerGuard> {
    if std::fs::create_dir_all(log_dir).is_err() {
        // Logging must never take the app down; fall back to stderr only.
        tracing_subscriber::fmt()
            .with_env_filter(default_filter())
            .init();
        return None;
    }
    let file_appender = tracing_appender::rolling::daily(log_dir, "lectorium.log");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::registry()
        .with(default_filter())
        .with(fmt::layer().with_writer(file_writer).with_ansi(false))
        .with(fmt::layer().with_writer(std::io::stderr))
        .init();
    Some(guard)
}

fn default_filter() -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))
}
