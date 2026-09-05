use super::*;

fn build_pdf(content_stream: &str) -> Vec<u8> {
    let objects: [String; 5] = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] \
         /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
            .to_string(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        format!(
            "<< /Length {} >>\nstream\n{}\nendstream",
            content_stream.len(),
            content_stream
        ),
    ];
    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = Vec::with_capacity(objects.len());
    for (i, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{}\nendobj\n", i + 1, body));
    }
    let xref_offset = pdf.len();
    pdf.push_str(&format!("xref\n0 {}\n", objects.len() + 1));
    pdf.push_str("0000000000 65535 f \n");
    for off in &offsets {
        pdf.push_str(&format!("{off:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF",
        objects.len() + 1,
        xref_offset
    ));
    pdf.into_bytes()
}

fn text_pdf() -> Vec<u8> {
    build_pdf("BT /F1 24 Tf 72 700 Td (Hello PDF) Tj ET")
}

#[test]
fn classifies_supported_extensions() {
    assert!(is_supported_extension(Path::new("/a/b/файл.md")));
    assert!(is_supported_extension(Path::new("note.MARKDOWN")));
    assert!(is_supported_extension(Path::new("note.Txt")));
    assert!(is_supported_extension(Path::new("doc.PDF")));
    assert!(!is_supported_extension(Path::new("archive.zip")));
    assert!(!is_supported_extension(Path::new("noext")));
}

#[test]
fn read_rejects_unsupported_extension() {
    let err = read_import_file(Path::new("/tmp/x.docx")).unwrap_err();
    assert_eq!(err, ERR_UNSUPPORTED_EXTENSION);
}

#[test]
fn read_rejects_oversized_text_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("big.md");
    std::fs::write(&path, vec![b'x'; (TEXT_MAX_BYTES + 1) as usize]).unwrap();
    assert_eq!(
        read_import_file(&path).unwrap_err(),
        too_large_message(TEXT_MAX_BYTES)
    );
}

#[test]
fn read_returns_text_content() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ok.md");
    std::fs::write(&path, "# Заголовок\nтекст").unwrap();
    assert_eq!(read_import_file(&path).unwrap(), "# Заголовок\nтекст");
}

#[test]
fn read_extracts_pdf_from_disk() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("doc.pdf");
    std::fs::write(&path, text_pdf()).unwrap();
    let text = read_import_file(&path).unwrap();
    assert!(text.contains("Hello"), "got: {text:?}");
    assert!(text.contains("PDF"), "got: {text:?}");
}

#[test]
fn extract_reports_scan_when_no_text_layer() {
    assert_eq!(
        extract_pdf_text(&build_pdf("")).unwrap_err(),
        ERR_PDF_NO_TEXT
    );
}

#[test]
fn extract_reports_parse_error_on_garbage() {
    assert_eq!(
        extract_pdf_text(b"this is not a pdf").unwrap_err(),
        ERR_PDF_PARSE
    );
}

#[test]
fn read_pdf_base64_round_trips() {
    let encoded = STANDARD.encode(text_pdf());
    let text = read_pdf_base64(&encoded).unwrap();
    assert!(text.contains("Hello"), "got: {text:?}");
}

#[test]
fn read_pdf_base64_rejects_bad_input() {
    assert_eq!(
        read_pdf_base64("!!! not base64").unwrap_err(),
        ERR_PDF_PARSE
    );
}

#[test]
fn read_pdf_base64_rejects_oversized() {
    let encoded = STANDARD.encode(vec![0u8; (PDF_MAX_BYTES + 1) as usize]);
    assert_eq!(
        read_pdf_base64(&encoded).unwrap_err(),
        too_large_message(PDF_MAX_BYTES)
    );
}

#[test]
fn normalize_collapses_blank_runs_and_trims() {
    let raw = "line one  \r\n\n\n\nline two\r\n\u{c}line three\n\n";
    assert_eq!(
        normalize_extracted_text(raw),
        "line one\n\nline two\n\nline three"
    );
}

#[test]
fn normalize_yields_empty_for_whitespace_only() {
    assert_eq!(normalize_extracted_text("  \n\n\t\r\n \u{c}"), "");
}

#[test]
fn text_files_outside_utf8_are_reported_not_mangled() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cp1251.txt");
    std::fs::write(&path, [0xcf_u8, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]).unwrap();
    assert_eq!(read_import_file(&path).unwrap_err(), ERR_TEXT_NOT_UTF8);
}

#[test]
fn oversized_base64_is_rejected_before_it_is_decoded() {
    // 4 символа base64 на 3 байта: строка длиннее лимита в 4/3 раза заведомо
    // не влезет, и декодировать её целиком незачем.
    let too_long = "A".repeat((PDF_MAX_BYTES as usize / 3 + 1) * 4);
    assert_eq!(read_pdf_base64(&too_long).unwrap_err(), too_large_message(PDF_MAX_BYTES));
}

#[test]
fn bounded_reader_accepts_the_limit_but_stops_an_unbounded_source() {
    const LIMIT: u64 = 16;
    assert_eq!(read_limited(&[b'x'; LIMIT as usize][..], LIMIT).unwrap().len(), LIMIT as usize);
    assert_eq!(read_limited(std::io::repeat(b'x'), LIMIT).unwrap_err(), too_large_message(LIMIT));
}

#[test]
fn base64_pdf_at_the_exact_size_limit_is_not_rejected_for_padding() {
    let mut pdf = text_pdf();
    pdf.resize(PDF_MAX_BYTES as usize, b' ');
    let encoded = STANDARD.encode(&pdf);
    assert!(encoded.ends_with('='));
    assert_eq!(decode_pdf_base64(&encoded).unwrap(), pdf);
}
