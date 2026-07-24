use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

use crate::app_state::{current_settings, App};
use crate::settings::PluginSetting;

pub const CURRENT_ARCH_KEY: &str = std::env::consts::ARCH;

const ICON_ALLOWLIST: &[&str] = &["crop", "camera", "scissors", "image", "aperture"];
const MANIFEST_FILE_NAME: &str = "plugin.json";
const INSTALLED_FILE_NAME: &str = "installed.json";
const SUPPORTED_IMAGE_TYPES: &[&str] = &["image/jpeg", "image/png", "image/gif", "image/webp"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum PluginCapability {
    AttachmentSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct PluginBins {
    #[serde(default)]
    pub aarch64: Option<String>,
    #[serde(default)]
    pub x86_64: Option<String>,
}

impl PluginBins {
    pub fn for_current_arch(&self) -> Option<&str> {
        match CURRENT_ARCH_KEY {
            "aarch64" => self.aarch64.as_deref(),
            "x86_64" => self.x86_64.as_deref(),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct PluginManifest {
    pub schema: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub icon: String,
    pub capability: PluginCapability,
    pub default_hotkey: String,
    pub min_host_version: String,
    pub bin: PluginBins,
}

pub fn parse_manifest(bytes: &[u8]) -> Result<PluginManifest, String> {
    serde_json::from_slice(bytes).map_err(|e| e.to_string())
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_valid_semver(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

pub fn validate_manifest(m: &PluginManifest) -> Result<(), String> {
    if !is_valid_id(&m.id) {
        return Err(format!("невалидный id плагина: {:?}", m.id));
    }
    if !is_valid_semver(&m.version) || !is_valid_semver(&m.min_host_version) {
        return Err(format!("невалидная версия: {} / {}", m.version, m.min_host_version));
    }
    if !ICON_ALLOWLIST.contains(&m.icon.as_str()) {
        return Err(format!("иконка вне allowlist: {:?}", m.icon));
    }
    if crate::hotkey::parse_hotkey(&m.default_hotkey).is_none() {
        return Err(format!("неразбираемый хоткей: {:?}", m.default_hotkey));
    }
    if m.bin.for_current_arch().is_none() {
        return Err(format!("нет бинаря для арх. {CURRENT_ARCH_KEY}"));
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct InstalledPlugin {
    pub manifest: PluginManifest,
    pub dir: PathBuf,
    pub update_available: Option<String>,
}

pub fn load_registry(cache_dir: &Path) -> Vec<InstalledPlugin> {
    let installed_raw = match std::fs::read(cache_dir.join(INSTALLED_FILE_NAME)) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    let installed: BTreeMap<String, String> = match serde_json::from_slice(&installed_raw) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[plugins] битый installed.json: {e}");
            return Vec::new();
        }
    };
    let mut out = Vec::new();
    for (id, version) in installed {
        let dir = cache_dir.join(&id).join(&version);
        let bytes = match std::fs::read(dir.join(MANIFEST_FILE_NAME)) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("[plugins] манифест {id}@{version} не читается: {e}");
                continue;
            }
        };
        let manifest = match parse_manifest(&bytes).and_then(|m| {
            validate_manifest(&m).map(|_| m)
        }) {
            Ok(m) if m.id == id => m,
            Ok(m) => {
                eprintln!("[plugins] id в манифесте ({}) != каталогу ({id})", m.id);
                continue;
            }
            Err(e) => {
                eprintln!("[plugins] манифест {id}@{version} невалиден: {e}");
                continue;
            }
        };
        out.push(InstalledPlugin { manifest, dir, update_available: None });
    }
    out
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PluginResult {
    Image { media_type: String, data_base64: String },
    Text { text: String },
    None,
    Error { message: String },
}

pub fn parse_result(stdout: &str) -> PluginResult {
    let line = stdout.trim();
    match serde_json::from_str::<PluginResult>(line) {
        Ok(r) => r,
        Err(e) => PluginResult::Error { message: format!("нераспознанный ответ плагина: {e}") },
    }
}

const ACTIVATE_REQUEST: &[u8] = b"{\"protocol\":1,\"action\":\"activate\"}\n";
const ACTIVATION_CEILING: Duration = Duration::from_secs(300);

pub async fn spawn_and_activate(bin_path: &Path) -> PluginResult {
    let mut child = match tokio::process::Command::new(bin_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return PluginResult::Error { message: format!("спавн плагина: {e}") },
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(ACTIVATE_REQUEST).await;
    }
    let out = match tokio::time::timeout(ACTIVATION_CEILING, child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return PluginResult::Error { message: format!("ожидание плагина: {e}") },
        Err(_) => return PluginResult::Error { message: "плагин не ответил (таймаут)".into() },
    };
    if !out.stderr.is_empty() {
        eprintln!("[plugin] {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    parse_result(&String::from_utf8_lossy(&out.stdout))
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum PluginState {
    Ready,
    Downloading,
    UpdateAvailable,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginDescriptor {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub icon: String,
    pub capability: PluginCapability,
    pub enabled: bool,
    pub hotkey: String,
    pub state: PluginState,
}

pub fn merge_descriptor(p: &InstalledPlugin, prefs: &[PluginSetting]) -> PluginDescriptor {
    let pref = prefs.iter().find(|s| s.id == p.manifest.id);
    let enabled = pref.map(|s| s.enabled).unwrap_or(false);
    let hotkey = pref
        .map(|s| s.hotkey.clone())
        .filter(|h| !h.trim().is_empty())
        .unwrap_or_else(|| p.manifest.default_hotkey.clone());
    let state = if p.update_available.is_some() {
        PluginState::UpdateAvailable
    } else {
        PluginState::Ready
    };
    PluginDescriptor {
        id: p.manifest.id.clone(),
        name: p.manifest.name.clone(),
        description: p.manifest.description.clone(),
        version: p.manifest.version.clone(),
        icon: p.manifest.icon.clone(),
        capability: p.manifest.capability.clone(),
        enabled,
        hotkey,
        state,
    }
}

#[tauri::command]
#[specta::specta]
pub fn list_plugins(app: AppHandle) -> Vec<PluginDescriptor> {
    let prefs = current_settings(&app).plugin_settings;
    let reg = app.state::<App>().plugins.lock().unwrap().clone();
    reg.iter().map(|p| merge_descriptor(p, &prefs)).collect()
}

fn is_enabled(prefs: &[PluginSetting], id: &str) -> bool {
    prefs.iter().find(|s| s.id == id).map(|s| s.enabled).unwrap_or(false)
}

pub async fn on_activate(app: &AppHandle, id: &str) {
    let settings = current_settings(app);
    if !is_enabled(&settings.plugin_settings, id) {
        return;
    }
    let installed = app
        .state::<App>()
        .plugins
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.manifest.id == id)
        .cloned();
    let Some(installed) = installed else { return };
    let Some(bin_name) = installed.manifest.bin.for_current_arch() else { return };
    let bin_path = installed.dir.join(bin_name);

    {
        let app_state = app.state::<App>();
        let mut active = app_state.plugins_activating.lock().unwrap();
        if !active.insert(id.to_string()) {
            return;
        }
    }

    let result = spawn_and_activate(&bin_path).await;
    app.state::<App>().plugins_activating.lock().unwrap().remove(id);

    match result {
        PluginResult::Image { media_type, data_base64 } => {
            if !SUPPORTED_IMAGE_TYPES.contains(&media_type.as_str()) {
                eprintln!("[plugin:{id}] неподдерживаемый media_type: {media_type}");
                return;
            }
            crate::events::plugin_result(
                app,
                crate::events::PluginResultPayload {
                    plugin_id: id.to_string(),
                    kind: "image".to_string(),
                    media_type: Some(media_type),
                    data_base64: Some(data_base64),
                    text: None,
                },
            );
            crate::window::show_and_focus_main(app);
        }
        PluginResult::Text { text } => {
            crate::events::plugin_result(
                app,
                crate::events::PluginResultPayload {
                    plugin_id: id.to_string(),
                    kind: "text".to_string(),
                    media_type: None,
                    data_base64: None,
                    text: Some(text),
                },
            );
        }
        PluginResult::None => {}
        PluginResult::Error { message } => eprintln!("[plugin:{id}] {message}"),
    }
}

#[tauri::command]
#[specta::specta]
pub fn activate_plugin(app: AppHandle, id: String) {
    tauri::async_runtime::spawn(async move { on_activate(&app, &id).await });
}

#[cfg(test)]
mod tests;
