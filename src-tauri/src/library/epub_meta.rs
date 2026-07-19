//! Minimal, defensive EPUB metadata extraction: container.xml -> OPF ->
//! title/creators/language/description/cover. Publication content is
//! untrusted; we only parse XML with quick-xml and never execute anything.

use quick_xml::events::Event;
use quick_xml::Reader;
use std::io::Read;
use std::path::Path;

const MAX_CONTAINER_BYTES: u64 = 1024 * 1024;
const MAX_OPF_BYTES: u64 = 4 * 1024 * 1024;
const MAX_COVER_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Default, Clone)]
pub struct EpubMeta {
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub language: Option<String>,
    pub description: Option<String>,
    /// Raw bytes + lowercase extension of the cover image, if any.
    pub cover: Option<(Vec<u8>, String)>,
}

pub fn read_epub_meta(path: &Path) -> Option<EpubMeta> {
    let file = std::fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;

    let opf_path = {
        let mut container = String::new();
        let mut entry = zip.by_name("META-INF/container.xml").ok()?;
        if entry.size() > MAX_CONTAINER_BYTES {
            return None;
        }
        entry.read_to_string(&mut container).ok()?;
        find_attr(&container, "rootfile", "full-path")?
    };

    let opf_dir = opf_path.rsplit_once('/').map(|(d, _)| d.to_string());
    let mut opf = String::new();
    let mut opf_entry = zip.by_name(&opf_path).ok()?;
    if opf_entry.size() > MAX_OPF_BYTES {
        return None;
    }
    opf_entry.read_to_string(&mut opf).ok()?;
    drop(opf_entry);

    let mut meta = parse_opf(&opf);

    // Resolve the cover: properties="cover-image" item, or <meta name="cover">.
    if let Some(href) = cover_href(&opf) {
        let full = match &opf_dir {
            Some(dir) => format!("{dir}/{href}"),
            None => href.clone(),
        };
        let full = normalize_zip_path(&full);
        if let Ok(mut entry) = zip.by_name(&full) {
            let mut bytes = Vec::new();
            if entry.size() <= MAX_COVER_BYTES
                && entry
                    .by_ref()
                    .take(MAX_COVER_BYTES + 1)
                    .read_to_end(&mut bytes)
                    .is_ok()
                && !bytes.is_empty()
                && bytes.len() as u64 <= MAX_COVER_BYTES
            {
                let ext = full
                    .rsplit_once('.')
                    .map(|(_, e)| e.to_ascii_lowercase())
                    .unwrap_or_else(|| "jpg".into());
                if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "webp") {
                    meta.cover = Some((bytes, ext));
                }
            }
        }
    }
    Some(meta)
}

fn parse_opf(opf: &str) -> EpubMeta {
    let mut meta = EpubMeta::default();
    let mut reader = Reader::from_str(opf);
    reader.config_mut().trim_text(true);
    let mut current: Option<&'static str> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                current = match local_name(e.name().as_ref()) {
                    "title" if meta.title.is_none() => Some("title"),
                    "creator" => Some("creator"),
                    "language" if meta.language.is_none() => Some("language"),
                    "description" if meta.description.is_none() => Some("description"),
                    _ => None,
                };
            }
            Ok(Event::Text(t)) => {
                if let Some(field) = current {
                    let text = t.decode().unwrap_or_default().trim().to_string();
                    if !text.is_empty() {
                        match field {
                            "title" => meta.title = Some(text),
                            "creator" => meta.authors.push(text),
                            "language" => meta.language = Some(text),
                            "description" => meta.description = Some(text),
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::End(_)) => current = None,
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    meta
}

/// href of the cover image inside the OPF manifest, if declared.
fn cover_href(opf: &str) -> Option<String> {
    // EPUB 3: <item properties="cover-image" href=...>
    if let Some(href) = item_with_property(opf, "cover-image") {
        return Some(href);
    }
    // EPUB 2: <meta name="cover" content="item-id"/> -> <item id="item-id" href=...>
    let cover_id = meta_cover_id(opf)?;
    item_href_by_id(opf, &cover_id)
}

fn each_element(xml: &str, name: &str) -> Vec<Vec<(String, String)>> {
    let mut out = Vec::new();
    let mut reader = Reader::from_str(xml);
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if local_name(e.name().as_ref()) == name {
                    let attrs = e
                        .attributes()
                        .flatten()
                        .map(|a| {
                            let raw = String::from_utf8_lossy(&a.value).to_string();
                            let value = quick_xml::escape::unescape(&raw)
                                .map(|c| c.to_string())
                                .unwrap_or(raw);
                            (local_name(a.key.as_ref()).to_string(), value)
                        })
                        .collect();
                    out.push(attrs);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}

fn item_with_property(opf: &str, property: &str) -> Option<String> {
    each_element(opf, "item").into_iter().find_map(|attrs| {
        let has = attrs
            .iter()
            .any(|(k, v)| k == "properties" && v.split_whitespace().any(|p| p == property));
        if has {
            attrs.into_iter().find(|(k, _)| k == "href").map(|(_, v)| v)
        } else {
            None
        }
    })
}

fn meta_cover_id(opf: &str) -> Option<String> {
    each_element(opf, "meta").into_iter().find_map(|attrs| {
        let is_cover = attrs.iter().any(|(k, v)| k == "name" && v == "cover");
        if is_cover {
            attrs
                .into_iter()
                .find(|(k, _)| k == "content")
                .map(|(_, v)| v)
        } else {
            None
        }
    })
}

fn item_href_by_id(opf: &str, id: &str) -> Option<String> {
    each_element(opf, "item").into_iter().find_map(|attrs| {
        let matches = attrs.iter().any(|(k, v)| k == "id" && v == id);
        if matches {
            attrs.into_iter().find(|(k, _)| k == "href").map(|(_, v)| v)
        } else {
            None
        }
    })
}

fn find_attr(xml: &str, element: &str, attr: &str) -> Option<String> {
    each_element(xml, element)
        .into_iter()
        .find_map(|attrs| attrs.into_iter().find(|(k, _)| k == attr).map(|(_, v)| v))
}

fn local_name(raw: &[u8]) -> &str {
    let s = std::str::from_utf8(raw).unwrap_or("");
    s.rsplit_once(':').map(|(_, l)| l).unwrap_or(s)
}

/// Collapse `a/../b` and strip `./` without touching the filesystem —
/// zip entry names are untrusted input and must not escape the archive.
fn normalize_zip_path(p: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for seg in p.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}
