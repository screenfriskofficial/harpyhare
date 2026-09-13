use std::str::FromStr;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::{hotkeys, recording, screenshot, window};

pub fn parse_hotkey(s: &str) -> Option<Shortcut> {
    Shortcut::from_str(s.trim()).ok()
}

fn unparseable_hotkey_error(hotkey: &str) -> String {
    format!("Не удалось разобрать хоткей: {hotkey:?}")
}

fn unregister_existing(app: &AppHandle, hotkey: &str) {
    if let Some(shortcut) = parse_hotkey(hotkey) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

fn defer(app: &AppHandle, work: fn(&AppHandle)) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { work(&app) });
}

type PttHandler = fn(&AppHandle);

fn register_ptt(
    app: &AppHandle,
    hotkey: &str,
    pressed: PttHandler,
    released: PttHandler,
) -> Result<(), String> {
    let shortcut = parse_hotkey(hotkey).ok_or_else(|| unparseable_hotkey_error(hotkey))?;
    unregister_existing(app, hotkey);
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| match event.state {
            ShortcutState::Pressed => defer(app, pressed),
            ShortcutState::Released => defer(app, released),
        })
        .map_err(|e| e.to_string())
}

pub fn register_system_ptt(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    register_ptt(
        app,
        hotkey,
        recording::on_system_ptt_pressed,
        recording::on_system_ptt_released,
    )
}

pub fn register_microphone_ptt(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    register_ptt(
        app,
        hotkey,
        recording::on_microphone_ptt_pressed,
        recording::on_microphone_ptt_released,
    )
}

pub fn unregister_ptt(app: &AppHandle, hotkey: &str) {
    if let Some(shortcut) = parse_hotkey(hotkey) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

pub fn register_toggle(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcut = parse_hotkey(hotkey).ok_or_else(|| unparseable_hotkey_error(hotkey))?;
    unregister_existing(app, hotkey);
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                defer(app, window::on_toggle_mini);
            }
        })
        .map_err(|e| e.to_string())
}

pub fn unregister_toggle(app: &AppHandle, hotkey: &str) {
    if let Some(shortcut) = parse_hotkey(hotkey) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

pub fn register_teleprompter(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcut = parse_hotkey(hotkey).ok_or_else(|| unparseable_hotkey_error(hotkey))?;
    unregister_existing(app, hotkey);
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                defer(app, window::on_toggle_teleprompter);
            }
        })
        .map_err(|e| e.to_string())
}

pub fn unregister_teleprompter(app: &AppHandle, hotkey: &str) {
    if let Some(shortcut) = parse_hotkey(hotkey) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

pub fn register_screenshot(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcut = parse_hotkey(hotkey).ok_or_else(|| unparseable_hotkey_error(hotkey))?;
    unregister_existing(app, hotkey);
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                defer(app, screenshot::on_capture_region);
            }
        })
        .map_err(|e| e.to_string())
}

pub fn unregister_screenshot(app: &AppHandle, hotkey: &str) {
    if let Some(shortcut) = parse_hotkey(hotkey) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

pub fn register_focus_prompt(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcut = parse_hotkey(hotkey).ok_or_else(|| unparseable_hotkey_error(hotkey))?;
    unregister_existing(app, hotkey);
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                defer(app, window::show_and_focus_prompt);
            }
        })
        .map_err(|e| e.to_string())
}

pub fn unregister_focus_prompt(app: &AppHandle, hotkey: &str) {
    if let Some(shortcut) = parse_hotkey(hotkey) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

pub fn register_duplicate_chat(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcut = parse_hotkey(hotkey).ok_or_else(|| unparseable_hotkey_error(hotkey))?;
    unregister_existing(app, hotkey);
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                defer(app, window::on_duplicate_chat);
            }
        })
        .map_err(|e| e.to_string())
}

pub fn unregister_duplicate_chat(app: &AppHandle, hotkey: &str) {
    if let Some(shortcut) = parse_hotkey(hotkey) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

pub fn register_panic(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcut = parse_hotkey(hotkey).ok_or_else(|| unparseable_hotkey_error(hotkey))?;
    unregister_existing(app, hotkey);
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                defer(app, window::on_panic);
            }
        })
        .map_err(|e| e.to_string())
}

pub fn unregister_panic(app: &AppHandle, hotkey: &str) {
    if let Some(shortcut) = parse_hotkey(hotkey) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

pub fn register_cancel(app: &AppHandle, hotkey: &str) {
    unregister_existing(app, hotkey);
    if let Some(shortcut) = parse_hotkey(hotkey) {
        let _ = app
            .global_shortcut()
            .on_shortcut(shortcut, |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    defer(app, recording::on_cancel);
                }
            });
    }
}

pub fn unregister_cancel(app: &AppHandle, hotkey: &str) {
    if let Some(shortcut) = parse_hotkey(hotkey) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

pub fn cancel_combo(app: &AppHandle) -> String {
    hotkeys::effective(
        &crate::app_state::current_settings(app).hotkeys,
        hotkeys::ACTION_CANCEL_RECORDING,
    )
}

#[cfg(test)]
mod tests;
