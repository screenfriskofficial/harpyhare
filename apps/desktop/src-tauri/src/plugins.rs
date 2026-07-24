use serde::{Deserialize, Serialize};

pub const CURRENT_ARCH_KEY: &str = std::env::consts::ARCH;

const ICON_ALLOWLIST: &[&str] = &["crop", "camera", "scissors", "image", "aperture"];

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

#[cfg(test)]
mod tests;
