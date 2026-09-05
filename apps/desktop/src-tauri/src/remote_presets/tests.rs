use super::*;

#[test]
fn bundled_presets_are_valid() {
    let pool = PresetPool::parse(BUNDLED_PRESETS_JSON).expect("вшитый presets.json валиден");
    assert!(!pool.presets.is_empty());
    assert!(pool.presets.iter().any(|p| p.id == "golang"));
}

#[test]
fn parse_rejects_empty_id() {
    assert!(
        PresetPool::parse(r#"{"version":1,"presets":[{"id":" ","name":"x","text":"y"}]}"#)
            .is_none()
    );
}

#[test]
fn parse_rejects_malformed_json() {
    assert!(PresetPool::parse("не json").is_none());
}

#[test]
fn parse_accepts_valid_pool() {
    let pool =
        PresetPool::parse(r#"{"version":2,"presets":[{"id":"a","name":"A","text":"t"}]}"#)
            .unwrap();
    assert_eq!(pool.version, 2);
    assert_eq!(pool.presets.len(), 1);
}

fn pool(version: u32, id: &str) -> String {
    format!(r#"{{"version":{version},"presets":[{{"id":"{id}","name":"N","text":"t"}}]}}"#)
}

#[test]
fn bundled_pool_declares_a_version() {
    // `load_initial` compares versions, so a bundled pool stuck at 0 would lose
    // to any cache forever.
    assert!(PresetPool::bundled().version > 0, "у вшитого пула должна быть версия");
}

#[test]
fn every_bundled_preset_declares_keyterms() {
    // Same invariant the frontend asserts, checked on the Rust side too: this
    // is the copy a user gets offline, before any blob is reachable.
    for preset in PresetPool::bundled().presets {
        assert!(
            preset.text.contains("[keywords]:"),
            "у пресета {} нет блока [keywords]",
            preset.id
        );
    }
}

#[test]
fn parse_rejects_an_empty_pool_and_duplicate_ids() {
    assert!(PresetPool::parse(r#"{"version":9,"presets":[]}"#).is_none(), "пустой пул стёр бы все пресеты");
    assert!(
        PresetPool::parse(
            r#"{"version":9,"presets":[{"id":"a","name":"A","text":"t"},{"id":"a","name":"B","text":"u"}]}"#
        )
        .is_none(),
        "дубль id не проходит"
    );
}

#[test]
fn a_fetched_pool_replaces_the_current_one_only_when_not_older_and_different() {
    let bundled = PresetPool::bundled();
    let newer = PresetPool::parse(&pool(bundled.version + 1, "from-blob")).unwrap();
    assert!(newer.should_replace(bundled.version, &bundled.presets));

    let same_version_new_content = PresetPool::parse(&pool(bundled.version, "edited")).unwrap();
    assert!(same_version_new_content.should_replace(bundled.version, &bundled.presets));

    let identical = PresetPool::parse(BUNDLED_PRESETS_JSON).unwrap();
    assert!(!identical.should_replace(bundled.version, &bundled.presets), "то же самое — не применяем и не эмитим");

    // The case that matters day to day: a build ships edited presets while the
    // blob still serves the previous pool, and the cache holds that older one.
    let older = PresetPool::parse(&pool(bundled.version - 1, "stale")).unwrap();
    assert!(!older.should_replace(bundled.version, &bundled.presets), "старый пул не перебивает свежую сборку");
}

#[test]
fn version_only_refresh_prevents_a_later_content_downgrade() {
    let initial = PresetPool::bundled();
    let newer = PresetPool { version: initial.version + 2, presets: initial.presets.clone() };
    assert!(newer.should_replace(initial.version, &initial.presets));
    let stale = PresetPool::parse(&pool(initial.version + 1, "stale")).unwrap();
    assert!(!stale.should_replace(newer.version, &newer.presets));
}
