use super::*;
use tauri_plugin_global_shortcut::{Code, Modifiers};

#[test]
fn single_letter_v_becomes_keyv() {
    let s = parse_hotkey("V").expect("V должна парситься");
    assert_eq!(s.key, Code::KeyV);
    assert_eq!(s.mods, Modifiers::empty());
}

#[test]
fn parsing_is_case_insensitive() {
    let upper = parse_hotkey("V").unwrap();
    let lower = parse_hotkey("v").unwrap();
    assert_eq!(upper.key, Code::KeyV);
    assert_eq!(lower.key, Code::KeyV);
}

#[test]
fn function_key_f9_parses() {
    let s = parse_hotkey("F9").expect("F9 должна парситься");
    assert_eq!(s.key, Code::F9);
    assert_eq!(s.mods, Modifiers::empty());
}

#[test]
fn modifier_combo_parses() {
    let s = parse_hotkey("Cmd+R").expect("Cmd+R должна парситься");
    assert_eq!(s.key, Code::KeyR);
    assert!(s.mods.contains(Modifiers::SUPER));
}

#[test]
fn escape_parses_for_cancel() {
    let s = parse_hotkey(&crate::hotkeys::effective(&[], crate::hotkeys::ACTION_CANCEL_RECORDING))
        .expect("Escape должна парситься");
    assert_eq!(s.key, Code::Escape);
}

#[test]
fn garbage_returns_none() {
    assert!(parse_hotkey("notakey").is_none());
    assert!(parse_hotkey("").is_none());
    assert!(parse_hotkey("   ").is_none());
    assert!(parse_hotkey("Ctrl+").is_none());
}
