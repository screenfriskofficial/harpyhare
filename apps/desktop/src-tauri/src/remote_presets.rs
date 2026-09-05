use crate::sync::LockUnpoisoned;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::events;
use crate::settings::{write_atomic_owner_only, PromptPreset};

const PRESETS_URL: &str =
    "https://wkbp547fx6lrgcth.public.blob.vercel-storage.com/harpyhare/presets.json";
const CACHE_FILE_NAME: &str = "presets.cache.json";
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const REFRESH_INTERVAL: Duration = Duration::from_secs(30 * 60);
const LOG_TAG: &str = "[presets]";

const BUNDLED_PRESETS_JSON: &str = include_str!("../../../../config/presets.json");

#[derive(Default, Serialize, Deserialize)]
pub struct PresetPool {
    pub version: u32,
    pub presets: Vec<PromptPreset>,
}

impl PresetPool {
    /// Пул принимается только целым: непустой, без пустых и повторяющихся id.
    /// Опечатка при публикации (пустой список, задвоенный id) иначе за полчаса
    /// доезжала до всех и кэшировалась до следующего бампа версии.
    pub fn parse(raw: &str) -> Option<Self> {
        let pool: PresetPool = serde_json::from_str(raw).ok()?;
        if pool.presets.is_empty() || pool.presets.iter().any(|p| p.id.trim().is_empty()) {
            return None;
        }
        let mut ids: Vec<&str> = pool.presets.iter().map(|p| p.id.trim()).collect();
        ids.sort_unstable();
        if ids.windows(2).any(|pair| pair[0] == pair[1]) {
            return None;
        }
        Some(pool)
    }

    /// Правило `apply`: сетевой пул применяется, если не старше локального и
    /// отличается содержимым или версией. Даже без правки текста повышение
    /// версии нужно сохранить: оно запрещает последующий откат.
    pub fn should_replace(&self, current_version: u32, current: &[PromptPreset]) -> bool {
        self.version > current_version
            || (self.version == current_version && self.presets != current)
    }

    fn bundled() -> Self {
        Self::parse(BUNDLED_PRESETS_JSON).unwrap_or_default()
    }
}

fn cache_path(app: &AppHandle) -> PathBuf {
    crate::app_state::app_data_file(app, CACHE_FILE_NAME)
}

/// The newer of the cached pool and the compiled-in one.
///
/// Cache-first would pin a user to whatever the blob served last, so a build
/// shipping newer presets would show the old ones until the blob caught up —
/// exactly the state a not-yet-published edit leaves you in. Comparing versions
/// makes a fresh build win on its own.
pub fn load_initial(app: &AppHandle) -> PresetPool {
    let cached = std::fs::read_to_string(cache_path(app))
        .ok()
        .and_then(|raw| PresetPool::parse(&raw));
    let bundled = PresetPool::bundled();
    match cached {
        Some(cached) if cached.version > bundled.version => cached,
        _ => bundled,
    }
}

pub fn spawn_refresh(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            match fetch().await {
                Ok(pool) => apply(&app, pool),
                Err(e) => eprintln!("{LOG_TAG} не удалось обновить пул: {e}"),
            }
            tokio::time::sleep(REFRESH_INTERVAL).await;
        }
    });
}

async fn fetch() -> Result<PresetPool, String> {
    let raw = fetch_raw().await.map_err(|e| e.to_string())?;
    PresetPool::parse(&raw).ok_or_else(|| "битый JSON пула пресетов".to_string())
}

async fn fetch_raw() -> reqwest::Result<String> {
    crate::tls::ensure_crypto_provider();
    let client = reqwest::Client::builder().timeout(FETCH_TIMEOUT).build()?;
    client
        .get(PRESETS_URL)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await
}

/// Applies a fetched pool unless it would move the user backwards.
///
/// **The pool never goes down a version.** Without this the refresh loop
/// overwrites a newer local pool with whatever the blob still serves, so an
/// edit to `config/presets.json` could not be tried out before publishing, and
/// a botched publish of an older file would reach every user within half an
/// hour. Rolling back on purpose means publishing with a bumped version.
fn apply(app: &AppHandle, pool: PresetPool) {
    let st = app.state::<crate::app_state::App>();
    {
        let mut current_version = st.official_presets_version.lock_unpoisoned();
        let mut current = st.official_presets.lock_unpoisoned();
        if !pool.should_replace(*current_version, &current) {
            if pool.version < *current_version {
                eprintln!(
                    "{LOG_TAG} пул из сети версии {} старше локального {} — не применяю",
                    pool.version, *current_version
                );
            }
            return;
        }
        *current = pool.presets.clone();
        *current_version = pool.version;
    }
    if let Ok(json) = serde_json::to_string(&pool) {
        let _ = write_atomic_owner_only(&cache_path(app), &json);
    }
    eprintln!("{LOG_TAG} пул обновлён (version {})", pool.version);
    events::official_presets_updated(app, pool.presets);
}

#[cfg(test)]
mod tests;
