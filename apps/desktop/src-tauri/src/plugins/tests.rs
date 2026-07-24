use super::*;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

static TMP_SEQ: AtomicU32 = AtomicU32::new(0);

fn unique_tmp_dir() -> PathBuf {
    let n = TMP_SEQ.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("harpyhare-plugins-test-{}-{n}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn install_fixture(cache: &Path, id: &str, version: &str) {
    let dir = cache.join(id).join(version);
    fs::create_dir_all(&dir).unwrap();
    let manifest = valid_manifest_json().replace("\"harpyshot\"", &format!("\"{id}\""));
    fs::write(dir.join("plugin.json"), manifest).unwrap();
    fs::write(cache.join("installed.json"), format!("{{\"{id}\":\"{version}\"}}")).unwrap();
}

fn valid_manifest_json() -> &'static str {
    r#"{"schema":1,"id":"harpyshot","name":"harpyshot","description":"d",
        "version":"1.0.0","icon":"crop","capability":"attachment_source",
        "default_hotkey":"Cmd+Shift+S","min_host_version":"0.9.0",
        "bin":{"aarch64":"harpyshot-aarch64","x86_64":"harpyshot-x86_64"}}"#
}

#[test]
fn parses_and_validates_a_good_manifest() {
    let m = parse_manifest(valid_manifest_json().as_bytes()).expect("parse");
    assert_eq!(m.id, "harpyshot");
    assert_eq!(m.capability, PluginCapability::AttachmentSource);
    assert!(validate_manifest(&m).is_ok());
}

#[test]
fn rejects_bad_id() {
    let mut m = parse_manifest(valid_manifest_json().as_bytes()).unwrap();
    m.id = "Harpy Shot!".to_string();
    assert!(validate_manifest(&m).is_err());
}

#[test]
fn rejects_unknown_icon() {
    let mut m = parse_manifest(valid_manifest_json().as_bytes()).unwrap();
    m.icon = "definitely-not-a-lucide-icon".to_string();
    assert!(validate_manifest(&m).is_err());
}

#[test]
fn rejects_unparseable_hotkey() {
    let mut m = parse_manifest(valid_manifest_json().as_bytes()).unwrap();
    m.default_hotkey = "".to_string();
    assert!(validate_manifest(&m).is_err());
}

#[test]
fn rejects_bad_semver() {
    let mut m = parse_manifest(valid_manifest_json().as_bytes()).unwrap();
    m.version = "1.x".to_string();
    assert!(validate_manifest(&m).is_err());
}

#[test]
fn parses_image_result() {
    let line = r#"{"protocol":1,"kind":"image","media_type":"image/png","data_base64":"AAAA"}"#;
    assert_eq!(
        parse_result(line),
        PluginResult::Image { media_type: "image/png".into(), data_base64: "AAAA".into() }
    );
}

#[test]
fn parses_none_result_ignoring_trailing_whitespace() {
    assert_eq!(parse_result("{\"protocol\":1,\"kind\":\"none\"}\n"), PluginResult::None);
}

#[test]
fn empty_or_garbage_stdout_is_error() {
    assert!(matches!(parse_result(""), PluginResult::Error { .. }));
    assert!(matches!(parse_result("not json"), PluginResult::Error { .. }));
}

#[test]
fn loads_installed_plugin_from_cache() {
    let cache = unique_tmp_dir();
    install_fixture(&cache, "harpyshot", "1.0.0");
    let reg = load_registry(&cache);
    assert_eq!(reg.len(), 1);
    assert_eq!(reg[0].manifest.id, "harpyshot");
    assert_eq!(reg[0].dir, cache.join("harpyshot").join("1.0.0"));
    fs::remove_dir_all(&cache).ok();
}

#[test]
fn missing_cache_yields_empty_registry() {
    let cache = std::env::temp_dir().join("harpyhare-plugins-test-nope-xyz");
    assert!(load_registry(&cache).is_empty());
}

#[test]
fn corrupt_installed_json_yields_empty_registry() {
    let cache = unique_tmp_dir();
    fs::write(cache.join("installed.json"), "{ not json").unwrap();
    assert!(load_registry(&cache).is_empty());
    fs::remove_dir_all(&cache).ok();
}

#[test]
fn entry_without_manifest_is_skipped() {
    let cache = unique_tmp_dir();
    fs::write(cache.join("installed.json"), "{\"harpyshot\":\"1.0.0\"}").unwrap();
    assert!(load_registry(&cache).is_empty());
    fs::remove_dir_all(&cache).ok();
}

#[test]
fn invalid_manifest_is_skipped() {
    let cache = unique_tmp_dir();
    let dir = cache.join("harpyshot").join("1.0.0");
    fs::create_dir_all(&dir).unwrap();
    let bad = valid_manifest_json().replace("\"crop\"", "\"not-an-allowed-icon\"");
    fs::write(dir.join("plugin.json"), bad).unwrap();
    fs::write(cache.join("installed.json"), "{\"harpyshot\":\"1.0.0\"}").unwrap();
    assert!(load_registry(&cache).is_empty());
    fs::remove_dir_all(&cache).ok();
}

#[test]
fn id_mismatch_is_skipped() {
    let cache = unique_tmp_dir();
    let dir = cache.join("other").join("1.0.0");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("plugin.json"), valid_manifest_json()).unwrap();
    fs::write(cache.join("installed.json"), "{\"other\":\"1.0.0\"}").unwrap();
    assert!(load_registry(&cache).is_empty());
    fs::remove_dir_all(&cache).ok();
}
