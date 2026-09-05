//! OpenRouter's dedicated transcription catalog, not the text/audio chat list.
use serde::{Deserialize, Serialize};

use super::{network_error, registry, warm_pooled_client, SttError};

const CATALOG_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const CATALOG_PATH: &str = "/api/v1/models";
const TRANSCRIPTION_MODALITY: &str = "transcription";

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct SttModelInfo {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize)]
struct Catalog {
    data: Vec<CatalogModel>,
}

#[derive(Deserialize)]
struct CatalogModel {
    id: String,
    name: String,
    architecture: Architecture,
}

#[derive(Deserialize)]
struct Architecture {
    input_modalities: Vec<String>,
    output_modalities: Vec<String>,
}

async fn fetch_models(
    client: &reqwest::Client,
    base_url: &str,
) -> Result<Vec<SttModelInfo>, SttError> {
    // The catalog is public (verified against the live API). No credentials in
    // this request or its frontend cache. Omitting limit/offset returns all rows.
    let response = client
        .get(format!("{base_url}{CATALOG_PATH}"))
        .query(&[("output_modalities", TRANSCRIPTION_MODALITY)])
        .timeout(CATALOG_TIMEOUT)
        .send()
        .await
        .map_err(network_error)?;
    if !response.status().is_success() {
        let code = response.status().as_u16();
        return Err(SttError::Other(
            crate::llm::api_error_message(response, code).await,
        ));
    }
    let catalog: Catalog = response
        .json()
        .await
        .map_err(|e| SttError::Other(format!("OpenRouter: {e}")))?;
    let mut models: Vec<SttModelInfo> = catalog
        .data
        .into_iter()
        .filter(|model| {
            !model.id.trim().is_empty()
                && !model.name.trim().is_empty()
                && model
                    .architecture
                    .input_modalities
                    .iter()
                    .any(|m| m == "audio")
                && model
                    .architecture
                    .output_modalities
                    .iter()
                    .any(|m| m == TRANSCRIPTION_MODALITY)
        })
        .map(|model| SttModelInfo {
            id: model.id,
            name: model.name,
        })
        .collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models.dedup_by(|a, b| a.id == b.id);
    models.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    Ok(models)
}

#[tauri::command]
#[specta::specta]
pub async fn list_openrouter_stt_models() -> Result<Vec<SttModelInfo>, String> {
    let spec = registry::resolve(registry::PROVIDER_OPENROUTER);
    fetch_models(&warm_pooled_client(), spec.wire.base_url())
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;
