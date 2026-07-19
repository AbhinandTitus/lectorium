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
        // MOBI/AZW3 are not EPUB containers. They stay out of the readable
        // library until an explicit, sandboxed conversion adapter exists.
        "mobi" | "azw3" => None,
        _ => None,
    }
}
