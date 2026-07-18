//! Library core: scanning, file identity, metadata extraction.

pub mod epub_meta;
pub mod scanner;

/// Formats Lectorium can open directly, mapped to rendering families.
pub fn classify(ext: &str) -> Option<(&'static str, &'static str)> {
    // (source_format, reading_format)
    match ext.to_ascii_lowercase().as_str() {
        "epub" => Some(("epub", "epub")),
        "pdf" => Some(("pdf", "pdf")),
        "txt" => Some(("txt", "text")),
        "md" | "markdown" => Some(("md", "text")),
        "html" | "htm" | "xhtml" => Some(("html", "text")),
        // Secondary import formats: listed, but need explicit Calibre conversion.
        "mobi" => Some(("mobi", "epub")),
        "azw3" => Some(("azw3", "epub")),
        _ => None,
    }
}
