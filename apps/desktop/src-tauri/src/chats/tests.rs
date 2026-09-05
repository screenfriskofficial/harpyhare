use super::*;

#[cfg(unix)]
fn assert_owner_only(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let mode = std::fs::metadata(path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
}

#[cfg(not(unix))]
fn assert_owner_only(_path: &std::path::Path) {}

#[test]
fn save_load_roundtrip_with_owner_only_perms() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("chats.json");
    let payload = r#"[{"id":"a","title":"Чат 1","messages":[],"draft":""}]"#;
    save(&path, payload).unwrap();
    assert_owner_only(&path);
    assert_eq!(load(&path).unwrap(), payload);
    assert!(!path.with_extension("tmp").exists());
}

#[test]
fn load_missing_file_gives_empty_string() {
    assert_eq!(load(&std::env::temp_dir().join("harpyhare-nonexistent/chats.json")).unwrap(), "");
}

#[test]
fn load_reports_an_unreadable_file_instead_of_pretending_it_is_empty() {
    // «Пусто» фронт трактует как «чатов нет» и первым же сохранением пишет
    // поверх файла — поэтому любая ошибка, кроме отсутствия файла, обязана
    // доехать до него ошибкой.
    let dir = tempfile::tempdir().unwrap();
    let not_utf8 = dir.path().join("chats.json");
    std::fs::write(&not_utf8, [0xff_u8, 0xfe, 0xfd]).unwrap();
    assert!(load(&not_utf8).is_err());

    let directory = dir.path().join("dir.json");
    std::fs::create_dir(&directory).unwrap();
    assert!(load(&directory).is_err());
}

#[test]
fn save_creates_parent_directories() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested/deeper/chats.json");
    save(&path, "[]").unwrap();
    assert!(path.exists());
}
