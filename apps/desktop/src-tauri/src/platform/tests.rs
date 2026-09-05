use super::*;
use crate::hotkeys::MODIFIER_COMBOS;

#[test]
fn every_offered_combo_parses_to_a_distinct_mask() {
    let mut seen = Vec::new();
    for combo in MODIFIER_COMBOS.current() {
        let mask = modifier_mask(combo);
        assert!(!mask.is_empty(), "комбо {combo:?} не разобрано в флаги");
        assert!(!seen.contains(&mask), "комбо {combo:?} дублирует уже занятые флаги");
        seen.push(mask);
    }
}

#[test]
fn unknown_token_yields_empty_mask() {
    assert!(modifier_mask("Fn").is_empty());
    assert!(modifier_mask("").is_empty());
}

#[test]
fn combo_spec_merges_flags_of_its_parts() {
    assert_eq!(
        modifier_mask("Cmd+Shift"),
        modifier_mask("Cmd") | modifier_mask("Shift")
    );
}

#[test]
fn every_modifier_default_is_offered_by_the_ui() {
    let families = crate::hotkeys::HOTKEY_ACTIONS
        .iter()
        .filter(|a| a.kind != crate::hotkeys::HotkeyKind::Combo);
    for action in families {
        assert!(
            MODIFIER_COMBOS.current().contains(&action.default_combo.current()),
            "дефолт {:?} не предлагается в UI",
            action.default_combo.current()
        );
    }
}

#[test]
fn only_web_urls_are_openable() {
    assert!(is_web_url("https://example.com"));
    assert!(is_web_url("http://example.com"));
    assert!(!is_web_url("file:///etc/passwd"));
    assert!(!is_web_url("smb://server/share"));
}

#[test]
fn named_bits_match_token_order() {
    use crate::hotkeys::{MODIFIER_ALT, MODIFIER_CMD, MODIFIER_CTRL, MODIFIER_SHIFT};
    assert_eq!(modifier_mask(MODIFIER_CMD), ModifierMask::CMD);
    assert_eq!(modifier_mask(MODIFIER_CTRL), ModifierMask::CTRL);
    assert_eq!(modifier_mask(MODIFIER_ALT), ModifierMask::ALT);
    assert_eq!(modifier_mask(MODIFIER_SHIFT), ModifierMask::SHIFT);
}

#[test]
fn mask_prints_its_tokens() {
    assert_eq!(modifier_mask("Ctrl+Shift").to_string(), "Ctrl+Shift");
    assert_eq!(ModifierMask::EMPTY.to_string(), "нет");
}

#[test]
fn aliases_from_the_plugin_and_the_frontend_yield_the_same_mask() {
    assert_eq!(modifier_mask("Control+Option"), modifier_mask("Ctrl+Alt"));
    assert_eq!(modifier_mask("Command+Shift"), modifier_mask("Cmd+Shift"));
    assert_eq!(modifier_mask("Super"), ModifierMask::CMD);
}
