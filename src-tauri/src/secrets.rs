//! Secrets live in the operating system's credential vault and nowhere
//! else: not in SQLite, not in settings, not in backups or exports, and
//! never in the WebView. Rust reads a secret only at the moment it signs a
//! request (docs/SECURITY.md).

use crate::error::AppError;
use std::collections::HashMap;
use std::sync::Mutex;

const SERVICE: &str = "com.abhin.lectorium";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Secret {
    /// Gemini API key for the optional reading companion
    GeminiApiKey,
    /// OAuth client secret of the reader's own Google Cloud desktop client
    DriveClientCredential,
    /// long-lived Google Drive refresh token (read-only scope)
    DriveRefreshToken,
}

impl Secret {
    fn account(self) -> &'static str {
        match self {
            Secret::GeminiApiKey => "gemini-api-key",
            Secret::DriveClientCredential => "drive-client-secret",
            Secret::DriveRefreshToken => "drive-refresh-token",
        }
    }
}

pub trait SecretStore: Send + Sync {
    fn get(&self, secret: Secret) -> Result<Option<String>, AppError>;
    fn set(&self, secret: Secret, value: &str) -> Result<(), AppError>;
    fn delete(&self, secret: Secret) -> Result<(), AppError>;
}

fn vault_error() -> AppError {
    AppError::Other("Lectorium could not reach this computer's credential vault.".into())
}

/// Windows Credential Manager / macOS Keychain.
pub struct VaultStore;

impl SecretStore for VaultStore {
    fn get(&self, secret: Secret) -> Result<Option<String>, AppError> {
        let entry = keyring::Entry::new(SERVICE, secret.account()).map_err(|_| vault_error())?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => {
                tracing::warn!(?error, "credential vault read failed");
                Err(vault_error())
            }
        }
    }

    fn set(&self, secret: Secret, value: &str) -> Result<(), AppError> {
        let entry = keyring::Entry::new(SERVICE, secret.account()).map_err(|_| vault_error())?;
        entry.set_password(value).map_err(|error| {
            tracing::warn!(?error, "credential vault write failed");
            vault_error()
        })
    }

    fn delete(&self, secret: Secret) -> Result<(), AppError> {
        let entry = keyring::Entry::new(SERVICE, secret.account()).map_err(|_| vault_error())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => {
                tracing::warn!(?error, "credential vault delete failed");
                Err(vault_error())
            }
        }
    }
}

/// Process-memory store: used by tests, and by development builds on
/// platforms without a native vault backend. Nothing is written to disk, so
/// secrets do not survive a restart there.
#[derive(Default)]
pub struct MemoryStore {
    values: Mutex<HashMap<Secret, String>>,
}

impl SecretStore for MemoryStore {
    fn get(&self, secret: Secret) -> Result<Option<String>, AppError> {
        Ok(self
            .values
            .lock()
            .map_err(|_| vault_error())?
            .get(&secret)
            .cloned())
    }

    fn set(&self, secret: Secret, value: &str) -> Result<(), AppError> {
        self.values
            .lock()
            .map_err(|_| vault_error())?
            .insert(secret, value.to_string());
        Ok(())
    }

    fn delete(&self, secret: Secret) -> Result<(), AppError> {
        self.values
            .lock()
            .map_err(|_| vault_error())?
            .remove(&secret);
        Ok(())
    }
}

/// The store this build should use.
pub fn platform_store() -> Box<dyn SecretStore> {
    if cfg!(any(windows, target_os = "macos")) {
        Box::new(VaultStore)
    } else {
        Box::new(MemoryStore::default())
    }
}

/// Managed state wrapper.
pub struct Secrets(pub Box<dyn SecretStore>);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_roundtrips_and_deletes() {
        let store = MemoryStore::default();
        assert_eq!(store.get(Secret::GeminiApiKey).unwrap(), None);
        store.set(Secret::GeminiApiKey, "k-123").unwrap();
        assert_eq!(
            store.get(Secret::GeminiApiKey).unwrap().as_deref(),
            Some("k-123")
        );
        assert_eq!(store.get(Secret::DriveRefreshToken).unwrap(), None);
        store.delete(Secret::GeminiApiKey).unwrap();
        assert_eq!(store.get(Secret::GeminiApiKey).unwrap(), None);
        // deleting what is not there is not an error
        store.delete(Secret::GeminiApiKey).unwrap();
    }
}
