use crate::sync::LockUnpoisoned;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::stream::{FuturesUnordered, StreamExt};
use tokio_util::sync::CancellationToken;

use super::{LlmError, LlmProvider, LlmRequest, LlmStreamSink, ModelCatalog, ModelInfo};

/// `warm_up` зовётся на каждое нажатие PTT, а пул и так держится тёплым
/// keep-alive'ом: чаще, чем раз в минуту, греть всех вендоров незачем.
const WARM_UP_MIN_INTERVAL: Duration = Duration::from_secs(60);

pub struct ProviderRouter {
    providers: Vec<Arc<dyn LlmProvider>>,
    /// Общий каталог приложения. **Пишет его только роутер** — слиянием ответов
    /// всех вендоров; клиенты каталог лишь читают. Иначе первый ответивший
    /// вендор затирал бы каталог одними своими моделями, пока роутер ждёт
    /// остальных, и модели остальных на это время уезжали бы к дефолту.
    catalog: ModelCatalog,
    last_warm_up: Mutex<Option<Instant>>,
}

impl ProviderRouter {
    pub fn new(providers: Vec<Arc<dyn LlmProvider>>, catalog: ModelCatalog) -> Self {
        assert!(!providers.is_empty(), "маршрутизатор без провайдеров");
        Self { providers, catalog, last_warm_up: Mutex::new(None) }
    }

    fn default_provider(&self) -> &Arc<dyn LlmProvider> {
        &self.providers[0]
    }

    /// Владелец модели: сначала живой каталог, затем сами вендоры
    /// (`owns_model` — офлайн-таблица или неймспейс), и лишь потом дефолт.
    fn provider_of_model(&self, model_id: &str) -> Option<String> {
        let from_catalog = self
            .catalog
            .lock_unpoisoned()
            .iter()
            .find(|m| m.id == model_id)
            .map(|m| m.provider.clone());
        from_catalog.or_else(|| {
            self.providers
                .iter()
                .find(|p| p.owns_model(model_id))
                .map(|p| p.provider_id().to_string())
        })
    }

    fn client_for(&self, model_id: &str) -> &Arc<dyn LlmProvider> {
        let Some(provider) = self.provider_of_model(model_id) else {
            return self.default_provider();
        };
        self.providers
            .iter()
            .find(|p| p.provider_id() == provider)
            .unwrap_or_else(|| self.default_provider())
    }

    /// Слияние каталогов: вендор, чей `list_models` упал, сохраняет свои
    /// прежние записи, а не выпадает из каталога на всю сессию — иначе один
    /// таймаут при старте отправлял бы все его модели к дефолтному вендору.
    fn merge_catalogs(
        &self,
        fetched: Vec<Result<Vec<ModelInfo>, LlmError>>,
    ) -> Vec<ModelInfo> {
        let previous = self.catalog.lock_unpoisoned().clone();
        let mut merged = Vec::new();
        for (provider, result) in self.providers.iter().zip(fetched) {
            match result {
                Ok(models) => merged.extend(models),
                Err(e) => {
                    let id = provider.provider_id();
                    eprintln!("каталог {id} не обновился ({e}) — прежние записи сохранены");
                    merged.extend(previous.iter().filter(|m| m.provider == id).cloned());
                }
            }
        }
        merged
    }

    fn warm_up_due(&self) -> bool {
        let mut last = self.last_warm_up.lock_unpoisoned();
        let due = last.is_none_or(|at| at.elapsed() >= WARM_UP_MIN_INTERVAL);
        if due {
            *last = Some(Instant::now());
        }
        due
    }
}

#[async_trait::async_trait]
impl LlmProvider for ProviderRouter {
    fn provider_id(&self) -> &'static str {
        self.default_provider().provider_id()
    }

    fn known_models(&self) -> Vec<ModelInfo> {
        self.providers.iter().flat_map(|p| p.known_models()).collect()
    }

    fn owns_model(&self, model_id: &str) -> bool {
        self.providers.iter().any(|p| p.owns_model(model_id))
    }

    async fn stream(
        &self,
        request: LlmRequest,
        cancel: CancellationToken,
        sink: &mut dyn LlmStreamSink,
    ) -> Result<(), LlmError> {
        self.client_for(&request.model)
            .stream(request, cancel, sink)
            .await
    }

    async fn count_tokens(&self, request: LlmRequest) -> Result<u32, LlmError> {
        self.client_for(&request.model).count_tokens(request).await
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let fetched =
            futures_util::future::join_all(self.providers.iter().map(|p| p.list_models())).await;
        let models = self.merge_catalogs(fetched);
        if !models.is_empty() {
            *self.catalog.lock_unpoisoned() = models.clone();
        }
        Ok(models)
    }

    async fn reachable(&self) -> bool {
        let mut in_flight: FuturesUnordered<_> =
            self.providers.iter().map(|p| p.reachable()).collect();
        while let Some(ok) = in_flight.next().await {
            if ok {
                return true;
            }
        }
        false
    }

    async fn warm_up(&self) {
        if !self.warm_up_due() {
            return;
        }
        futures_util::future::join_all(self.providers.iter().map(|p| p.warm_up())).await;
    }
}

#[cfg(test)]
mod tests;
