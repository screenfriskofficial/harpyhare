use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::io::Read;
use std::panic::AssertUnwindSafe;
use std::path::Path;

const MEGABYTE: u64 = 1_048_576;
pub const TEXT_MAX_BYTES: u64 = MEGABYTE;
pub const PDF_MAX_BYTES: u64 = 20 * MEGABYTE;

const TEXT_EXTENSIONS: [&str; 3] = ["md", "markdown", "txt"];
const PDF_EXTENSION: &str = "pdf";

pub const ERR_UNSUPPORTED_EXTENSION: &str = "Поддерживаются только файлы .md, .txt и .pdf";
pub const ERR_TEXT_NOT_UTF8: &str = "Текстовый файл не в кодировке UTF-8";
/// Байт base64 на три байта данных: по этому отношению размер проверяется
/// ДО декодирования, а не после аллокации всего буфера.
const BASE64_CHARS_PER_TRIPLET: u64 = 4;
const BYTES_PER_BASE64_TRIPLET: u64 = 3;
pub const ERR_PDF_NO_TEXT: &str =
    "В PDF нет текстового слоя — похоже, это скан. Распознавание изображений пока не поддерживается.";
pub const ERR_PDF_PARSE: &str = "Не удалось разобрать PDF";

enum ImportKind {
    Text,
    Pdf,
}

fn classify(path: &Path) -> Option<ImportKind> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        Some(ImportKind::Text)
    } else if ext == PDF_EXTENSION {
        Some(ImportKind::Pdf)
    } else {
        None
    }
}

pub fn is_supported_extension(path: &Path) -> bool {
    classify(path).is_some()
}

fn too_large_message(max_bytes: u64) -> String {
    format!("Файл больше {} МБ", max_bytes / MEGABYTE)
}

/// Read at most one byte beyond the limit, even if the file grows after open.
fn read_limited(reader: impl Read, max_bytes: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader.take(max_bytes + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > max_bytes {
        return Err(too_large_message(max_bytes));
    }
    Ok(bytes)
}

pub fn read_import_file(path: &Path) -> Result<String, String> {
    let kind = classify(path).ok_or(ERR_UNSUPPORTED_EXTENSION)?;
    let max_bytes = match kind {
        ImportKind::Text => TEXT_MAX_BYTES,
        ImportKind::Pdf => PDF_MAX_BYTES,
    };
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Для импорта нужен обычный файл".into());
    }
    if meta.len() > max_bytes {
        return Err(too_large_message(max_bytes));
    }
    let bytes = read_limited(file, max_bytes)?;
    match kind {
        ImportKind::Text => String::from_utf8(bytes).map_err(|_| ERR_TEXT_NOT_UTF8.to_string()),
        ImportKind::Pdf => extract_pdf_text(&bytes),
    }
}

pub fn read_pdf_base64(data_base64: &str) -> Result<String, String> {
    extract_pdf_text(&decode_pdf_base64(data_base64)?)
}

fn decode_pdf_base64(data_base64: &str) -> Result<Vec<u8>, String> {
    let data_base64 = data_base64.trim();
    // Padding can make the decoded upper bound exceed the limit by two bytes.
    let max_encoded_len = PDF_MAX_BYTES.div_ceil(BYTES_PER_BASE64_TRIPLET) * BASE64_CHARS_PER_TRIPLET;
    if data_base64.len() as u64 > max_encoded_len {
        return Err(too_large_message(PDF_MAX_BYTES));
    }
    let bytes = STANDARD
        .decode(data_base64)
        .map_err(|_| ERR_PDF_PARSE.to_string())?;
    if bytes.len() as u64 > PDF_MAX_BYTES {
        return Err(too_large_message(PDF_MAX_BYTES));
    }
    Ok(bytes)
}

fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    let raw = std::panic::catch_unwind(AssertUnwindSafe(|| {
        pdf_extract::extract_text_from_mem(bytes)
    }))
    .map_err(|_| ERR_PDF_PARSE.to_string())?
    .map_err(|_| ERR_PDF_PARSE.to_string())?;
    finalize_extracted(&raw)
}

fn finalize_extracted(raw: &str) -> Result<String, String> {
    let text = normalize_extracted_text(raw);
    if text.is_empty() {
        return Err(ERR_PDF_NO_TEXT.into());
    }
    Ok(text)
}

fn normalize_extracted_text(raw: &str) -> String {
    let unified = raw.replace('\r', "").replace('\u{c}', "\n");
    let mut out = String::with_capacity(unified.len());
    let mut blank_run = 0usize;
    for line in unified.split('\n') {
        let trimmed = line.trim_end();
        if trimmed.trim().is_empty() {
            blank_run += 1;
            if blank_run == 1 {
                out.push('\n');
            }
            continue;
        }
        blank_run = 0;
        out.push_str(trimmed);
        out.push('\n');
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests;
