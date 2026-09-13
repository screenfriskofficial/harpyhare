use std::sync::Arc;

use futures_util::stream::{FuturesUnordered, StreamExt};
use tokio_util::sync::CancellationToken;

use super::{LlmError, LlmProvider, LlmRequest, LlmStreamSink, ModelCatalog, ModelInfo};

pub struct ProviderRouter {
    providers: Vec<Arc<dyn LlmProvider>>,
    catalog: ModelCatalog,
}

impl ProviderRouter {
    pub fn new(providers: Vec<Arc<dyn LlmProvider>>, catalog: ModelCatalog) -> Self {
        assert!(!providers.is_empty(), "маршрутизатор без провайдеров");
        Self { providers, catalog }
    }

    fn default_provider(&self) -> &Arc<dyn LlmProvider> {
        &self.providers[0]
    }

    fn provider_of_model(&self, model_id: &str) -> Option<String> {
        let from_catalog = self
            .catalog
            .lock()
            .unwrap()
            .iter()
            .find(|m| m.id == model_id)
            .map(|m| m.provider.clone());
        from_catalog.or_else(|| {
            self.providers
                .iter()
                .flat_map(|p| p.known_models())
                .find(|m| m.id == model_id)
                .map(|m| m.provider)
        }).or_else(|| {
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
}

#[async_trait::async_trait]
impl LlmProvider for ProviderRouter {
    fn provider_id(&self) -> &'static str {
        self.default_provider().provider_id()
    }

    fn known_models(&self) -> Vec<ModelInfo> {
        self.providers.iter().flat_map(|p| p.known_models()).collect()
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
        let models: Vec<ModelInfo> = fetched.into_iter().flat_map(Result::unwrap_or_default).collect();
        if !models.is_empty() {
            *self.catalog.lock().unwrap() = models.clone();
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
        futures_util::future::join_all(self.providers.iter().map(|p| p.warm_up())).await;
    }
}

#[cfg(test)]
mod tests;
