use super::*;

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
