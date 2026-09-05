use crate::sync::LockUnpoisoned;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};

use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

use crate::{access, capture, llm, settings, state, stt};

const SETTINGS_FILE_NAME: &str = "settings.json";
const CHATS_FILE_NAME: &str = "chats.json";
const CONTEXT_LIBRARY_FILE_NAME: &str = "context-library.json";

pub struct App {
    pub settings: Mutex<settings::Settings>,
    /// Замок на read-modify-write настроек (`set_settings` с главного потока,
    /// `redeem_access_code`/`clear_access_token` с рабочего): пара
    /// «клон → запись на диск → store» обязана быть атомарной, иначе устаревший
    /// снимок одного пути стирает то, что только что записал другой.
    pub settings_edit: Mutex<()>,
    pub official_presets: Mutex<Vec<settings::PromptPreset>>,
    /// Version of the pool above — the refresh loop refuses to go below it.
    pub official_presets_version: Mutex<u32>,
    pub recorder: Mutex<state::RecorderState>,
    pub recording_enabled: AtomicBool,
    pub transcription_cancel: Mutex<Option<CancellationToken>>,
    pub capture: Mutex<Option<capture::AudioCapture>>,
    pub capture_error: Mutex<Option<crate::error::AppError>>,
    // Batch upload and retry share immutable audio; cloning a ten-minute
    // recording here would copy about 38 MB while holding the mutex.
    pub last_recording: Mutex<Option<Arc<crate::recording::RecordedAudio>>>,
    pub llm_cancel: Mutex<HashMap<String, ActiveLlmStream>>,
    pub stt: Mutex<Arc<dyn stt::SttEngine>>,
    pub llm: Mutex<Arc<dyn llm::LlmProvider>>,
    pub recording_session: Mutex<Option<crate::recording::RecordingSession>>,
    pub models: llm::ModelCatalog,
    pub recording_gen: AtomicU64,
    pub resize_gen: AtomicU64,
    pub window_mini: AtomicBool,
    pub capture_rebuild_pending: AtomicBool,
    pub http_pool_stale: AtomicBool,
    /// Terms the active chat declared via `[keywords]: [...]`.
    ///
    /// Runtime state, NOT a setting: it is derived from the prompt the user is
    /// already writing and follows the active chat. `Settings.stt_keywords`
    /// does not exist on purpose — a hand-kept dictionary was rejected, and
    /// this must not become one through the back door.
    pub stt_keyterms: Mutex<Vec<String>>,
    pub preview_html: Mutex<String>,
    pub pending_update: Mutex<Option<tauri_plugin_updater::Update>>,
    pub update_installing: AtomicBool,
    /// Очередь PTT-событий — см. `recording::PttEvent`. Заводится один раз в
    /// `setup_app` (`install_ptt_worker`).
    pub ptt_events: OnceLock<tokio::sync::mpsc::UnboundedSender<crate::recording::PttEvent>>,
}

#[derive(Clone)]
pub struct ActiveLlmStream {
    pub stream_id: String,
    pub cancel: CancellationToken,
}

pub struct SttStream {
    pub(crate) handle: tauri::async_runtime::JoinHandle<Result<String, stt::SttError>>,
    pub(crate) cancel: CancellationToken,
    pub(crate) broken: Arc<AtomicBool>,
}

pub fn app_data_file(app: &AppHandle, file_name: &str) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .expect("app_data_dir")
        .join(file_name)
}

pub fn settings_path(app: &AppHandle) -> std::path::PathBuf {
    app_data_file(app, SETTINGS_FILE_NAME)
}

pub fn chats_path(app: &AppHandle) -> std::path::PathBuf {
    app_data_file(app, CHATS_FILE_NAME)
}

pub fn context_library_path(app: &AppHandle) -> std::path::PathBuf {
    app_data_file(app, CONTEXT_LIBRARY_FILE_NAME)
}

pub fn current_settings(app: &AppHandle) -> settings::Settings {
    app.state::<App>().settings.lock_unpoisoned().clone()
}

pub fn llm_provider(app: &AppHandle) -> Arc<dyn llm::LlmProvider> {
    Arc::clone(&*app.state::<App>().llm.lock_unpoisoned())
}

pub fn stt_keyterms(app: &AppHandle) -> Vec<String> {
    app.state::<App>().stt_keyterms.lock_unpoisoned().clone()
}

pub fn stt_engine(app: &AppHandle) -> Arc<dyn stt::SttEngine> {
    Arc::clone(&*app.state::<App>().stt.lock_unpoisoned())
}

pub fn build_capture(
    settings: &settings::Settings,
) -> Result<Option<capture::AudioCapture>, capture::CaptureError> {
    if !settings.capture_system_audio {
        return Ok(None);
    }
    let uid =
        (!settings.capture_device_uid.is_empty()).then_some(settings.capture_device_uid.as_str());
    let capture = capture::AudioCapture::system(uid, settings.buffer_seconds.into())?;
    capture.set_buffering(settings.buffer_enabled);
    Ok(Some(capture))
}

/// What reaching the chosen STT vendor takes right now.
#[derive(Clone, PartialEq)]
pub struct SttClientPlan {
    /// The vendor `Settings.stt_provider` names, already resolved — an unknown
    /// value has become the default here, not somewhere downstream.
    pub provider_id: &'static str,
    pub api_key: String,
    pub proxy_base_url: Option<String>,
}

impl std::fmt::Debug for SttClientPlan {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SttClientPlan")
            .field("provider_id", &self.provider_id)
            .field(
                "api_key",
                &format_args!("<{} симв.>", self.api_key.chars().count()),
            )
            .field("proxy_base_url", &self.proxy_base_url)
            .finish()
    }
}

/// Same rule as the answer vendors: an access code reaches the relay, a
/// personal key reaches the vendor. Unlike the answer side there is no router —
/// exactly one STT vendor is active, the one the setting names.
pub fn stt_client_plan(s: &settings::Settings) -> SttClientPlan {
    let spec = stt::registry::resolve(&s.stt_provider);
    if s.access_token.is_empty() || !spec.proxied {
        return SttClientPlan {
            provider_id: spec.id,
            api_key: settings::api_key_for(s, spec.key_id).to_string(),
            proxy_base_url: None,
        };
    }
    SttClientPlan {
        provider_id: spec.id,
        api_key: s.access_token.clone(),
        proxy_base_url: Some(access::proxy_base_url()),
    }
}

/// Транспорт выбирает фабрика `stt::build_engine` по диалекту строки реестра;
/// здесь решается только доступ (ключ или relay) — см. `stt_client_plan`.
pub fn build_stt_client(s: &settings::Settings) -> Arc<dyn stt::SttEngine> {
    let plan = stt_client_plan(s);
    stt::build_engine(
        stt::registry::resolve(plan.provider_id),
        stt::SttClientConfig {
            api_key: plan.api_key,
            proxy_base_url: plan.proxy_base_url,
            language: s.stt_language.clone(),
            translate: s.stt_translate,
        },
    )
}

/// How a vendor is reached right now: the relay under an access code, the
/// user's own key otherwise, or not at all.
pub enum ProviderAccess {
    Proxied {
        access_token: String,
        base_url: String,
    },
    Direct {
        api_key: String,
    },
}

/// Resolves a registry row against the current settings. The rule is the same
/// for every vendor, which is why it lives here and not in each client: an
/// access code reaches whatever the relay proxies, and a personal key reaches
/// its own vendor directly.
pub fn provider_access(
    spec: &llm::registry::LlmProviderSpec,
    s: &settings::Settings,
) -> Option<ProviderAccess> {
    if !s.access_token.is_empty() && spec.proxied {
        return Some(ProviderAccess::Proxied {
            access_token: s.access_token.clone(),
            base_url: access::proxy_base_url(),
        });
    }
    let api_key = settings::api_key_for(s, spec.key_id);
    if api_key.is_empty() {
        return None;
    }
    Some(ProviderAccess::Direct {
        api_key: api_key.to_string(),
    })
}

/// Builds the client for a registry row, or `None` for a row whose access mode
/// the dialect cannot serve.
///
/// Dispatch is on the **dialect**, not on the vendor: a vendor that speaks a
/// protocol the app already knows needs no arm here and no module — only its
/// row. A genuinely new protocol adds a variant to `LlmWire`, a module beside
/// `llm/responses.rs`, and one arm below.
fn build_provider(
    spec: &'static llm::registry::LlmProviderSpec,
    access: ProviderAccess,
    catalog: &llm::ModelCatalog,
) -> Option<Arc<dyn llm::LlmProvider>> {
    Some(match spec.wire {
        llm::registry::LlmWire::Anthropic { .. } => {
            let client = match access {
                ProviderAccess::Proxied {
                    access_token,
                    base_url,
                } => llm::AnthropicClient::for_proxy(access_token, base_url),
                ProviderAccess::Direct { api_key } => llm::AnthropicClient::new(api_key),
            };
            Arc::new(client.with_catalog(Arc::clone(catalog)))
        }
        llm::registry::LlmWire::Responses { .. } => match access {
            ProviderAccess::Proxied {
                access_token,
                base_url,
            } => Arc::new(llm::responses::ResponsesClient::proxied(
                spec,
                access_token,
                base_url,
            )),
            ProviderAccess::Direct { api_key } => {
                Arc::new(llm::responses::ResponsesClient::direct(spec, api_key))
            }
        },
        // У диалекта Xclis прокси-режима нет (строка несёт `proxied: false`,
        // и тест реестра это держит). Строка с перевёрнутым флагом раньше
        // роняла `setup_app` паникой у каждого держателя кода — теперь вендор
        // просто пропускается с записью в stderr.
        llm::registry::LlmWire::Xclis { .. } => match access {
            ProviderAccess::Direct { api_key } => Arc::new(
                llm::xclis::XclisClient::new(spec, api_key).with_catalog(Arc::clone(catalog)),
            ),
            ProviderAccess::Proxied { .. } => {
                eprintln!(
                    "{}: диалект Xclis не ходит через relay — вендор пропущен",
                    spec.id
                );
                return None;
            }
        },
    })
}

/// **The default provider is always present, reachable or not.** It carries the
/// default model and every unclaimed model id, so a router without it would
/// have nowhere to send them; an unusable client fails with a real API error,
/// which is far better than a request that silently goes nowhere.
pub fn build_llm_client(
    s: &settings::Settings,
    catalog: llm::ModelCatalog,
) -> Arc<dyn llm::LlmProvider> {
    let mut providers: Vec<Arc<dyn llm::LlmProvider>> = llm::registry::PROVIDERS
        .iter()
        .filter_map(|spec| {
            let access = provider_access(spec, s)?;
            build_provider(spec, access, &catalog)
        })
        .collect();
    if providers.is_empty() {
        let fallback = llm::AnthropicClient::new(s.anthropic_api_key.clone())
            .with_catalog(Arc::clone(&catalog));
        providers.push(Arc::new(fallback));
    }
    Arc::new(llm::router::ProviderRouter::new(providers, catalog))
}

pub fn note_connectivity_probe(app: &AppHandle, reachable: bool) {
    let st = app.state::<App>();
    if reachable {
        if st.http_pool_stale.swap(false, Ordering::AcqRel) {
            recycle_pooled_http_clients(app);
        }
    } else {
        st.http_pool_stale.store(true, Ordering::Release);
    }
}

fn recycle_pooled_http_clients(app: &AppHandle) {
    let st = app.state::<App>();
    // Serialize the snapshot AND publication with settings/token edits; otherwise
    // a reconnect can publish clients carrying keys that were just replaced.
    let _edit = st.settings_edit.lock_unpoisoned();
    let settings = current_settings(app);
    let rebuilt_stt = build_stt_client(&settings);
    *st.stt.lock_unpoisoned() = Arc::clone(&rebuilt_stt);
    let rebuilt_llm = build_llm_client(&settings, Arc::clone(&st.models));
    *st.llm.lock_unpoisoned() = Arc::clone(&rebuilt_llm);
    tauri::async_runtime::spawn(async move {
        tokio::join!(rebuilt_stt.warm_up(), rebuilt_llm.warm_up());
    });
}

pub fn build_app_state(
    settings: settings::Settings,
    official_presets: crate::remote_presets::PresetPool,
    capture: Option<capture::AudioCapture>,
    stt: Arc<dyn stt::SttEngine>,
    llm: Arc<dyn llm::LlmProvider>,
    models: llm::ModelCatalog,
) -> App {
    App {
        settings: Mutex::new(settings),
        settings_edit: Mutex::new(()),
        official_presets_version: Mutex::new(official_presets.version),
        official_presets: Mutex::new(official_presets.presets),
        recorder: Mutex::new(state::RecorderState::Idle),
        recording_enabled: AtomicBool::new(false),
        transcription_cancel: Mutex::new(None),
        capture: Mutex::new(capture),
        capture_error: Mutex::new(None),
        last_recording: Mutex::new(None),
        llm_cancel: Mutex::new(HashMap::new()),
        stt: Mutex::new(stt),
        llm: Mutex::new(llm),
        recording_session: Mutex::new(None),
        models,
        recording_gen: AtomicU64::new(0),
        resize_gen: AtomicU64::new(0),
        window_mini: AtomicBool::new(false),
        capture_rebuild_pending: AtomicBool::new(false),
        http_pool_stale: AtomicBool::new(false),
        stt_keyterms: Mutex::new(Vec::new()),
        preview_html: Mutex::new(String::new()),
        pending_update: Mutex::new(None),
        update_installing: AtomicBool::new(false),
        ptt_events: OnceLock::new(),
    }
}

#[cfg(test)]
mod tests;
