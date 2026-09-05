//! Глю над `tauri-plugin-global-shortcut`: регистрация системных шорткатов и
//! диспетчеризация их событий. Реестр действий (id, дефолты, конфликты) живёт
//! в `hotkeys.rs`; здесь — только ОС.
//!
//! **Все обработчики деферятся**: плагин зовёт колбэк, держа свой мьютекс
//! реестра, и регистрация или снятие шортката прямо из колбэка — реентрантный
//! дедлок, который замораживает приложение целиком.

use std::str::FromStr;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::recording::{self, PttEvent};
use crate::{hotkeys, window};

/// Обработчик системного шортката: указатель на функцию, а не замыкание —
/// `on_shortcut` требует `Fn + Send + Sync + 'static`, и это самая дешёвая
/// форма, которая проходит без аллокации на нажатие.
pub type Handler = fn(&AppHandle);

pub fn parse_hotkey(s: &str) -> Option<Shortcut> {
    Shortcut::from_str(s.trim()).ok()
}

fn unparseable_hotkey_error(hotkey: &str) -> String {
    format!("Не удалось разобрать хоткей: {hotkey:?}")
}

fn defer(app: &AppHandle, work: Handler) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { work(&app) });
}

fn shortcut_of(hotkey: &str) -> Result<Shortcut, String> {
    parse_hotkey(hotkey).ok_or_else(|| unparseable_hotkey_error(hotkey))
}

/// Регистрирует сочетание идемпотентно: то же сочетание сначала снимается.
/// Повторная регистрация без снятия у плагина на macOS затирала прежний
/// `EventHotKeyRef`, и клавиша оставалась перехваченной системно до выхода.
fn register_shortcut<F>(app: &AppHandle, hotkey: &str, on_event: F) -> Result<(), String>
where
    F: Fn(&AppHandle, ShortcutState) + Send + Sync + 'static,
{
    let shortcut = shortcut_of(hotkey)?;
    let _ = app.global_shortcut().unregister(shortcut);
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| on_event(app, event.state))
        .map_err(|e| e.to_string())
}

/// Обычное действие: срабатывает на нажатие, обработчик уходит в рантайм.
pub fn register(app: &AppHandle, hotkey: &str, handler: Handler) -> Result<(), String> {
    register_shortcut(app, hotkey, move |app, state| {
        if state == ShortcutState::Pressed {
            defer(app, handler);
        }
    })
}

pub fn unregister(app: &AppHandle, hotkey: &str) {
    if let Some(shortcut) = parse_hotkey(hotkey) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

/// Push-to-talk — единственное действие с двумя фазами. Обе уходят в очередь
/// PTT-событий, а не отдельными задачами: порядок «нажато → отпущено» обязан
/// сохраниться (см. `recording::PttEvent`).
pub fn register_ptt(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    register_shortcut(app, hotkey, |app, state| {
        let event = match state {
            ShortcutState::Pressed => PttEvent::Pressed,
            ShortcutState::Released => PttEvent::Released,
        };
        recording::enqueue_ptt(app, event);
    })
}

/// Отмена записи (Esc) живёт только пока идёт запись; тем же путём, что PTT.
pub fn register_cancel(app: &AppHandle, hotkey: &str) {
    let _ = register_shortcut(app, hotkey, |app, state| {
        if state == ShortcutState::Pressed {
            recording::enqueue_ptt(app, PttEvent::Cancel);
        }
    });
}

pub fn unregister_cancel(app: &AppHandle, hotkey: &str) {
    unregister(app, hotkey);
}

pub fn cancel_combo(app: &AppHandle) -> String {
    hotkeys::effective(
        &crate::app_state::current_settings(app).hotkeys,
        hotkeys::ACTION_CANCEL_RECORDING,
    )
}

pub fn register_toggle(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    register(app, hotkey, window::on_toggle_mini)
}

pub fn register_teleprompter(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    register(app, hotkey, window::on_toggle_teleprompter)
}

pub fn register_screenshot(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    register(app, hotkey, crate::screenshot::on_capture_region)
}

pub fn register_focus_prompt(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    register(app, hotkey, window::show_and_focus_prompt)
}

pub fn register_duplicate_chat(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    register(app, hotkey, window::on_duplicate_chat)
}

#[cfg(test)]
mod tests;
