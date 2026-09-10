use crate::sync::LockUnpoisoned;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::app_state::{current_settings, settings_path, App};
use crate::{platform, recording};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum PermissionState {
    Unknown,
    Granted,
    Denied,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum PermissionKind {
    Audio,
    Microphone,
    Screen,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsStatus {
    pub audio: PermissionState,
    pub microphone: PermissionState,
    pub screen: PermissionState,
}

pub const AUDIO_REQUIRES_PERMISSION: bool = cfg!(target_os = "macos");

pub fn state_from_granted(granted: bool) -> PermissionState {
    if granted {
        PermissionState::Granted
    } else {
        PermissionState::Denied
    }
}

fn audio_state(app: &AppHandle) -> PermissionState {
    if !AUDIO_REQUIRES_PERMISSION {
        return PermissionState::Granted;
    }
    if app.state::<App>().capture.lock_unpoisoned().is_some() {
        return PermissionState::Granted;
    }
    if !current_settings(app).audio_permission_requested {
        return PermissionState::Unknown;
    }
    state_from_granted(recording::ensure_capture(app))
}

/// Reading authorization never opens the device or prompts the user.
pub fn microphone_state() -> PermissionState {
    #[cfg(target_os = "macos")]
    {
        use cidre::av;
        match av::CaptureDevice::authorization_status_for_media_type(av::MediaType::audio()) {
            Ok(av::AuthorizationStatus::Authorized) => PermissionState::Granted,
            Ok(av::AuthorizationStatus::NotDetermined) => PermissionState::Unknown,
            _ => PermissionState::Denied,
        }
    }
    #[cfg(target_os = "windows")]
    {
        PermissionState::Granted
    } // WASAPI reports denied desktop access when opening.
}

async fn request_microphone_permission() -> Result<PermissionState, String> {
    #[cfg(target_os = "macos")]
    {
        use cidre::av;
        let receiver = {
            let (sender, receiver) = tokio::sync::oneshot::channel();
            let mut sender = Some(sender);
            let mut callback = cidre::blocks::SendBlock::new1(move |granted: bool| {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(granted);
                }
            });
            av::CaptureDevice::request_access_for_media_type_ch(
                av::MediaType::audio(),
                &mut callback,
            )
            .map_err(|e| format!("Не удалось запросить микрофон: {e:?}"))?;
            receiver
        };
        receiver
            .await
            .map(state_from_granted)
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        Ok(microphone_state())
    }
}

fn screen_state(app: &AppHandle) -> PermissionState {
    if platform::screen_capture_access() {
        return PermissionState::Granted;
    }
    if current_settings(app).screen_permission_requested {
        PermissionState::Denied
    } else {
        PermissionState::Unknown
    }
}

fn mark_requested(app: &AppHandle, kind: PermissionKind) -> Result<(), String> {
    let st = app.state::<App>();
    let _edit = st.settings_edit.lock_unpoisoned();
    let mut settings = st.settings.lock_unpoisoned().clone();
    let flag = match kind {
        PermissionKind::Audio => &mut settings.audio_permission_requested,
        PermissionKind::Screen => &mut settings.screen_permission_requested,
        PermissionKind::Microphone => return Ok(()),
    };
    if *flag {
        return Ok(());
    }
    *flag = true;
    settings
        .save(&settings_path(app))
        .map_err(|e| e.to_string())?;
    *st.settings.lock_unpoisoned() = settings;
    Ok(())
}

/// Обе команды — async с `spawn_blocking`: создание Core Audio tap (и его
/// дроп с join потоков) стоит сотен миллисекунд, а синхронная команда делала
/// это на главном потоке — при каждом монтировании лаунчера, пока капчера нет.
#[tauri::command]
#[specta::specta]
pub async fn permissions_status(app: AppHandle) -> PermissionsStatus {
    tokio::task::spawn_blocking(move || PermissionsStatus {
        audio: audio_state(&app),
        microphone: microphone_state(),
        screen: screen_state(&app),
    })
    .await
    .unwrap_or(PermissionsStatus {
        audio: PermissionState::Unknown,
        microphone: microphone_state(),
        screen: PermissionState::Unknown,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn request_permission(
    app: AppHandle,
    kind: PermissionKind,
) -> Result<PermissionState, String> {
    if kind == PermissionKind::Microphone {
        return request_microphone_permission().await;
    }
    tokio::task::spawn_blocking(move || request_permission_blocking(&app, kind))
        .await
        .map_err(|e| e.to_string())?
}

fn request_permission_blocking(
    app: &AppHandle,
    kind: PermissionKind,
) -> Result<PermissionState, String> {
    match kind {
        PermissionKind::Microphone => Ok(microphone_state()),
        PermissionKind::Audio => {
            if !AUDIO_REQUIRES_PERMISSION {
                return Ok(PermissionState::Granted);
            }
            mark_requested(app, kind)?;
            Ok(state_from_granted(recording::rebuild_capture(app)))
        }
        PermissionKind::Screen => {
            mark_requested(app, kind)?;
            Ok(state_from_granted(platform::request_screen_capture_access()))
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn open_permission_settings(kind: PermissionKind) {
    match kind {
        PermissionKind::Audio => platform::open_audio_capture_privacy_pane(),
        PermissionKind::Microphone => platform::open_microphone_privacy_pane(),
        PermissionKind::Screen => platform::open_screen_capture_privacy_pane(),
    }
}

/// Explicit recovery only: ad-hoc updates can leave a TCC grant tied to the
/// previous cdhash. The OS switch stays enabled although preflight returns false.
/// Restart after resetting our screen grant to discard CoreGraphics' cached state.
#[tauri::command]
#[specta::specta]
pub async fn reset_screen_permission_and_restart(app: AppHandle) -> Result<(), String> {
    if crate::window::main_window(&app).is_some() {
        return Err("Сначала остановите рабочее окно и вернитесь в лаунчер".into());
    }
    let handle = app.clone();
    tokio::task::spawn_blocking(move || {
        platform::reset_screen_capture_access(&handle.config().identifier)?;
        let st = handle.state::<App>();
        let _edit = st.settings_edit.lock_unpoisoned();
        let mut settings = st.settings.lock_unpoisoned().clone();
        settings.screen_permission_requested = false;
        settings
            .save(&settings_path(&handle))
            .map_err(|e| e.to_string())?;
        *st.settings.lock_unpoisoned() = settings;
        Ok::<_, String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    app.restart()
}

#[cfg(test)]
mod tests;
