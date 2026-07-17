use serde::Serialize;

/// App-level error. Commands return `Result<T, AppError>`; the frontend
/// receives a stable `{ kind, message }` shape with calm copy — raw
/// diagnostics go to the local log, never to the main UI.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Lectorium could not open its local database.")]
    Database(#[from] rusqlite::Error),
    #[error("Lectorium could not access a local file. Your original was not changed.")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    kind: &'a str,
    message: String,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let kind = match self {
            AppError::Database(_) => "database",
            AppError::Io(_) => "io",
            AppError::Other(_) => "other",
        };
        tracing::error!(error = ?self, "command error");
        ErrorBody {
            kind,
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}
