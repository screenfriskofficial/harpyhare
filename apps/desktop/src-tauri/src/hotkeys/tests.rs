use super::*;

fn binding(action: &str, combo: &str) -> HotkeyBinding {
    HotkeyBinding { action: action.to_string(), combo: combo.to_string() }
}

fn digit_family_action(id: &'static str) -> HotkeyAction {
    HotkeyAction {
        id,
        group: "",
        label: "",
        hint: "",
        kind: HotkeyKind::ModifierDigits,
        scope: HotkeyScope::Hud,
        default_combo: PlatformCombo::shared(MODIFIER_CMD),
    }
}

type ComboOfPlatform = fn(&PlatformCombo) -> &'static str;

const PLATFORM_VIEWS: [(&str, ComboOfPlatform, &[&str]); 2] = [
    ("macos", |c| c.macos, MODIFIER_COMBOS.macos),
    ("windows", |c| c.windows, MODIFIER_COMBOS.windows),
];

#[test]
fn registry_ids_unique_and_defaults_parseable() {
    let mut ids: Vec<&str> = HOTKEY_ACTIONS.iter().map(|a| a.id).collect();
    let count = ids.len();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), count, "id действий должны быть уникальны");

    for (platform, combo_of, offered) in PLATFORM_VIEWS {
        for a in HOTKEY_ACTIONS {
            let combo = combo_of(&a.default_combo);
            match a.kind {
                HotkeyKind::Combo => assert!(
                    crate::global_shortcuts::parse_hotkey(combo).is_some(),
                    "дефолт {} ({platform}) не разбирается: {combo}",
                    a.id
                ),
                _ => assert!(
                    offered.contains(&combo),
                    "модификатор {} ({platform}) не из реестра: {combo}",
                    a.id
                ),
            }
        }
    }
}

#[test]
fn registry_defaults_do_not_conflict() {
    for (platform, combo_of, _) in PLATFORM_VIEWS {
        for a in HOTKEY_ACTIONS {
            for b in HOTKEY_ACTIONS {
                assert!(
                    !conflict(
                        a.id,
                        combo_of(&a.default_combo),
                        b.id,
                        combo_of(&b.default_combo)
                    ),
                    "дефолты конфликтуют ({platform}): {} и {}",
                    a.id,
                    b.id
                );
            }
        }
    }
}

#[test]
fn windows_defaults_avoid_the_super_key() {
    for a in HOTKEY_ACTIONS {
        assert!(
            !a.default_combo.windows.contains(MODIFIER_CMD),
            "дефолт {} на Windows не должен использовать клавишу Win: {}",
            a.id,
            a.default_combo.windows
        );
    }
    for combo in MODIFIER_COMBOS.windows {
        assert!(
            !combo.contains(MODIFIER_CMD),
            "модификатор {combo} на Windows не предлагается"
        );
    }
}

#[test]
fn effective_falls_back_to_default_and_prefers_last_binding() {
    assert_eq!(effective(&[], ACTION_RECORD), "Cmd+R");
    assert_eq!(effective(&[binding(ACTION_RECORD, "Cmd+Shift+X")], ACTION_RECORD), "Cmd+Shift+X");
    let twice = vec![binding(ACTION_RECORD, "F8"), binding(ACTION_RECORD, "F7")];
    assert_eq!(effective(&twice, ACTION_RECORD), "F7");
}

#[test]
fn combo_conflict_ignores_modifier_order_and_case() {
    assert!(conflict(ACTION_RECORD, "Cmd+Shift+X", ACTION_SEND, "Shift+Cmd+X"));
    assert!(conflict(ACTION_RECORD, "cmd+x", ACTION_SEND, "Cmd+X"));
    assert!(conflict(ACTION_RECORD, "Cmd+KeyX", ACTION_SEND, "Cmd+X"));
    assert!(!conflict(ACTION_RECORD, "Cmd+X", ACTION_SEND, "Cmd+Y"));
}

#[test]
fn arrow_and_plus_minus_families_share_modifier_without_conflict() {
    assert!(!conflict(ACTION_RESIZE_WINDOW, "Cmd+Shift", ACTION_OPACITY, "Cmd+Shift"));
    assert!(conflict(ACTION_RESIZE_WINDOW, "Cmd+Shift", ACTION_SCROLL_CHAT, "Cmd+Shift"));
}

#[test]
fn combo_conflicts_with_family_it_falls_into() {
    assert!(conflict(ACTION_SEND, "Cmd+ArrowUp", ACTION_MOVE_WINDOW, "Cmd"));
    assert!(conflict(ACTION_SEND, "Cmd+Shift+Minus", ACTION_OPACITY, "Cmd+Shift"));
    assert!(!conflict(ACTION_SEND, "Cmd+Enter", ACTION_MOVE_WINDOW, "Cmd"));
}

#[test]
fn digit_family_conflicts_only_with_digit_combos() {
    assert!(conflict(ACTION_SEND, "Cmd+1", ACTION_QUICK_ACTION, "Cmd"));
    assert!(conflict(ACTION_SEND, "Cmd+Digit9", ACTION_QUICK_ACTION, "Cmd"));
    assert!(!conflict(ACTION_SEND, "Cmd+0", ACTION_QUICK_ACTION, "Cmd"));
    assert!(!conflict(ACTION_SEND, "Cmd+Enter", ACTION_QUICK_ACTION, "Cmd"));
    assert!(!conflict(ACTION_SEND, "Alt+1", ACTION_QUICK_ACTION, "Cmd"));
}

#[test]
fn digit_family_shares_a_modifier_with_the_arrow_and_plus_minus_families() {
    assert!(!conflict(ACTION_MOVE_WINDOW, "Cmd", ACTION_QUICK_ACTION, "Cmd"));
    assert!(!conflict(ACTION_OPACITY, "Cmd", ACTION_QUICK_ACTION, "Cmd"));
}

#[test]
fn two_digit_families_collide_on_a_shared_modifier() {
    let first = digit_family_action("первое");
    let second = digit_family_action("второе");
    assert!(key_spaces_overlap(&first, "Cmd", &second, "Cmd"));
    assert!(!key_spaces_overlap(&first, "Cmd", &second, "Alt"));
}

#[test]
fn transient_scopes_of_recording_and_teleprompter_may_share_a_combo() {
    assert!(!conflict(ACTION_CANCEL_RECORDING, "Escape", ACTION_TELEPROMPTER_CLOSE, "Escape"));
    assert!(conflict(ACTION_CANCEL_RECORDING, "Escape", ACTION_TOGGLE_WINDOW, "Escape"));
    assert!(conflict(ACTION_TELEPROMPTER_CLOSE, "Space", ACTION_SEND, "Space"));
}

#[test]
fn stream_cancel_shares_escape_with_the_other_transient_scopes() {
    assert!(!conflict(ACTION_CANCEL_STREAM, "Escape", ACTION_CANCEL_RECORDING, "Escape"));
    assert!(!conflict(ACTION_CANCEL_STREAM, "Escape", ACTION_TELEPROMPTER_CLOSE, "Escape"));
    assert!(conflict(ACTION_CANCEL_STREAM, "Escape", ACTION_TOGGLE_WINDOW, "Escape"));
}

#[test]
fn empty_combo_means_unassigned_and_never_conflicts() {
    assert!(!conflict(ACTION_RECORD, "", ACTION_SEND, ""));
    assert!(!conflict(ACTION_RECORD, "", ACTION_SEND, "Cmd+Enter"));
}

#[test]
fn normalize_drops_unknown_actions_and_duplicate_entries() {
    let mut bindings = vec![
        binding("нет такого", "Cmd+Q"),
        binding(ACTION_RECORD, "F8"),
        binding(ACTION_RECORD, "F7"),
    ];
    normalize(&mut bindings);
    assert_eq!(bindings, vec![binding(ACTION_RECORD, "F7")]);
}

#[test]
fn normalize_gives_a_combo_to_the_latest_claimant() {
    let mut bindings =
        vec![binding(ACTION_TOGGLE_WINDOW, "Cmd+Shift+X"), binding(ACTION_RECORD, "Cmd+Shift+X")];
    normalize(&mut bindings);
    assert_eq!(effective(&bindings, ACTION_RECORD), "Cmd+Shift+X");
    assert_eq!(effective(&bindings, ACTION_TOGGLE_WINDOW), "", "прежний владелец остаётся без хоткея");
}

#[test]
fn normalize_takes_a_combo_away_from_an_untouched_default() {
    let mut bindings = vec![binding(ACTION_SEND, "Cmd+T")];
    normalize(&mut bindings);
    assert_eq!(effective(&bindings, ACTION_SEND), "Cmd+T");
    assert_eq!(
        effective(&bindings, ACTION_TELEPROMPTER),
        "",
        "дефолтный владелец Cmd+T теряет сочетание"
    );
}

#[test]
fn normalize_leaves_untouched_defaults_out_of_the_list() {
    let mut bindings = vec![binding(ACTION_RECORD, "Cmd+R")];
    normalize(&mut bindings);
    assert!(bindings.is_empty(), "совпадающее с дефолтом не хранится");
}

#[test]
fn migration_moves_legacy_fields_and_skips_untouched_defaults() {
    let mut raw = serde_json::json!({
        "hotkey": "Cmd+Shift+X",
        "toggle_hotkey": "Cmd+Shift+H",
        "screenshot_hotkey": "Cmd+Shift+A",
        "scroll_modifier": "Alt",
        "theme": "black",
    });
    migrate_legacy_fields(&mut raw);
    let object = raw.as_object().unwrap();
    assert!(!object.contains_key("hotkey"), "старые поля убираются из json");
    assert_eq!(object.get("theme").and_then(|v| v.as_str()), Some("black"));

    let bindings: Vec<HotkeyBinding> =
        serde_json::from_value(object.get("hotkeys").cloned().unwrap()).unwrap();
    assert_eq!(
        bindings,
        vec![binding(ACTION_RECORD, "Cmd+Shift+X"), binding(ACTION_SCREENSHOT, "Cmd+Shift+A")]
    );
}

#[test]
fn migration_keeps_existing_bindings_untouched() {
    let mut raw = serde_json::json!({
        "hotkey": "F5",
        "hotkeys": [{ "action": ACTION_RECORD, "combo": "F6" }],
    });
    migrate_legacy_fields(&mut raw);
    let bindings: Vec<HotkeyBinding> =
        serde_json::from_value(raw.get("hotkeys").cloned().unwrap()).unwrap();
    assert_eq!(bindings, vec![binding(ACTION_RECORD, "F6")]);
}

#[test]
fn malformed_bindings_are_dropped_and_a_non_array_field_is_removed() {
    let mut raw = serde_json::json!({
        "hotkeys": [
            {"action": "record", "combo": "F8"},
            5,
            {"action": "x"},
            {"combo": "F1"},
            {"action": 1, "combo": "F2"}
        ]
    });
    drop_malformed_bindings(&mut raw);
    assert_eq!(raw["hotkeys"], serde_json::json!([{"action": "record", "combo": "F8"}]));

    let mut raw = serde_json::json!({"hotkeys": "F8"});
    drop_malformed_bindings(&mut raw);
    assert!(raw.get("hotkeys").is_none(), "поле не того типа убирается целиком");

    let mut raw = serde_json::json!({"auto_send": true});
    drop_malformed_bindings(&mut raw);
    assert_eq!(raw, serde_json::json!({"auto_send": true}));
}

/// Алиасы плагина и фронта разбираются здесь так же, иначе `Control+S` в
/// файле настроек регистрировался бы как Ctrl+S, а конфликты считались по
/// голой `S`.
#[test]
fn modifier_aliases_resolve_to_the_canonical_tokens() {
    assert_eq!(canonical_modifier("Control"), Some(MODIFIER_CTRL));
    assert_eq!(canonical_modifier("command"), Some(MODIFIER_CMD));
    assert_eq!(canonical_modifier("Super"), Some(MODIFIER_CMD));
    assert_eq!(canonical_modifier("META"), Some(MODIFIER_CMD));
    assert_eq!(canonical_modifier("Option"), Some(MODIFIER_ALT));
    assert_eq!(canonical_modifier("shift"), Some(MODIFIER_SHIFT));
    assert_eq!(canonical_modifier("Fn"), None);
    assert!(conflict(ACTION_RECORD, "Control+S", ACTION_SEND, "Ctrl+S"));
    assert!(conflict(ACTION_RECORD, "Command+Option+S", ACTION_SEND, "Alt+Cmd+S"));
}

#[test]
fn every_alias_maps_onto_a_bit_of_the_modifier_mask() {
    for (alias, canonical) in MODIFIER_ALIASES {
        let index = modifier_index(alias).unwrap_or_else(|| panic!("{alias} без бита"));
        assert_eq!(MODIFIER_TOKENS[index], *canonical);
    }
}
