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
    Screen,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsStatus {
    pub audio: PermissionState,
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
    if app.state::<App>().capture.lock().unwrap().is_some() {
        return PermissionState::Granted;
    }
    if !current_settings(app).audio_permission_requested {
        return PermissionState::Unknown;
    }
    state_from_granted(recording::ensure_capture(app))
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
    let _edit = st.settings_edit.lock().unwrap();
    let mut settings = st.settings.lock().unwrap().clone();
    let flag = match kind {
        PermissionKind::Audio => &mut settings.audio_permission_requested,
        PermissionKind::Screen => &mut settings.screen_permission_requested,
    };
    if *flag {
        return Ok(());
    }
    *flag = true;
    settings
        .save(&settings_path(app))
        .map_err(|e| e.to_string())?;
    *st.settings.lock().unwrap() = settings;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn permissions_status(app: AppHandle) -> PermissionsStatus {
    PermissionsStatus {
        audio: audio_state(&app),
        screen: screen_state(&app),
    }
}

#[tauri::command]
#[specta::specta]
pub fn request_permission(app: AppHandle, kind: PermissionKind) -> Result<PermissionState, String> {
    match kind {
        PermissionKind::Audio => {
            if !AUDIO_REQUIRES_PERMISSION {
                return Ok(PermissionState::Granted);
            }
            mark_requested(&app, kind)?;
            Ok(state_from_granted(recording::rebuild_capture(&app)))
        }
        PermissionKind::Screen => {
            mark_requested(&app, kind)?;
            Ok(state_from_granted(platform::request_screen_capture_access()))
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn open_permission_settings(kind: PermissionKind) {
    match kind {
        PermissionKind::Audio => platform::open_audio_capture_privacy_pane(),
        PermissionKind::Screen => platform::open_screen_capture_privacy_pane(),
    }
}

#[cfg(test)]
mod tests;
