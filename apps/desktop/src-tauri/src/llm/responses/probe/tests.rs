use super::*;
use serde_json::json;

/// The refusals below are copied from live answers of 2026-10-20 — the probe
/// reads exactly these shapes.
fn refusal(code: Option<&str>, param: Option<&str>, message: &str) -> Value {
    json!({"error": {"code": code, "param": param, "message": message, "type": "invalid_request_error"}})
}

#[test]
fn a_listed_level_set_is_read_from_the_message() {
    let body = refusal(
        Some(ERROR_UNSUPPORTED_VALUE),
        Some(PARAM_REASONING_EFFORT),
        "Unsupported value: 'minimal' is not supported with the 'o3' model. \
         Supported values are: 'low', 'medium', and 'high'.",
    );
    assert_eq!(
        read_refusal(400, &body),
        Reading::Settled(Verdict::Reasoning {
            levels: vec!["low".into(), "medium".into(), "high".into()]
        })
    );
}

#[test]
fn the_rejected_value_is_not_mistaken_for_a_supported_one() {
    // 'minimal' and the model id are quoted too, but before the marker.
    let levels = supported_values(
        "Unsupported value: 'minimal' is not supported with the 'chat-latest' model. \
         Supported values are: 'medium'.",
    );
    assert_eq!(levels, Some(vec!["medium".to_string()]));
}

#[test]
fn a_reworded_message_teaches_nothing_rather_than_something_wrong() {
    let body = refusal(
        Some(ERROR_UNSUPPORTED_VALUE),
        Some(PARAM_REASONING_EFFORT),
        "This model only takes a few levels.",
    );
    assert_eq!(read_refusal(400, &body), Reading::Unknown);
}

#[test]
fn a_model_without_reasoning_is_plain() {
    let body = refusal(
        Some(ERROR_UNSUPPORTED_PARAMETER),
        Some(PARAM_REASONING_EFFORT),
        "Unsupported parameter: 'reasoning.effort' is not supported with this model.",
    );
    assert_eq!(read_refusal(400, &body), Reading::Settled(Verdict::Plain));
}

#[test]
fn models_the_endpoint_does_not_serve_are_unavailable() {
    let missing = refusal(
        Some(ERROR_MODEL_NOT_FOUND),
        None,
        "The model `tts-1` does not exist or you do not have access to it.",
    );
    assert_eq!(
        read_refusal(404, &missing),
        Reading::Settled(Verdict::Unavailable)
    );
    let other_endpoint = refusal(
        Some(ERROR_MODEL_NOT_FOUND),
        Some("model"),
        "The requested model 'gpt-image-1' is not supported with the Responses API.",
    );
    assert_eq!(
        read_refusal(400, &other_endpoint),
        Reading::Settled(Verdict::Unavailable)
    );
}

#[test]
fn the_decoy_stopping_the_request_means_the_level_was_taken() {
    let body = refusal(
        None,
        Some(PARAM_TEMPERATURE),
        "Unsupported parameter: 'temperature' is not supported with this model.",
    );
    assert_eq!(read_refusal(400, &body), Reading::LevelAccepted);
}

#[test]
fn rate_limits_and_outages_are_not_verdicts() {
    let limited = refusal(Some("rate_limit_exceeded"), None, "Slow down.");
    assert_eq!(read_refusal(429, &limited), Reading::Unknown);
    assert_eq!(read_refusal(500, &Value::Null), Reading::Unknown);
    assert_eq!(read_refusal(401, &Value::Null), Reading::Unknown);
}

#[test]
fn every_probe_carries_the_decoy_and_the_smallest_output() {
    for level in PROBE_LEVELS {
        let body = probe_body("gpt-x", level);
        assert_eq!(body["reasoning"]["effort"], level);
        assert_eq!(body["temperature"], DECOY_TEMPERATURE);
        assert_eq!(body["max_output_tokens"], PROBE_MAX_OUTPUT_TOKENS);
        assert_eq!(body["store"], false);
    }
}

#[test]
fn a_model_taking_both_probe_levels_never_gets_an_off_value() {
    let Verdict::Reasoning { levels } = takes_every_probed_level() else {
        panic!("рассуждающая модель");
    };
    assert!(!levels.iter().any(|l| l == "none"));
    for e in Effort::ALL {
        assert!(levels.iter().any(|l| l == e.as_str()));
    }
}

#[test]
fn verdicts_are_kept_per_vendor_and_expire() {
    let cache = ModelProbes::in_memory();
    cache.remember("openai", &[("gpt-x".into(), Verdict::Plain)], 1_000);
    assert_eq!(cache.fresh("openai", "gpt-x", 1_000), Some(Verdict::Plain));
    assert_eq!(cache.fresh("other", "gpt-x", 1_000), None);
    let expired = 1_000 + VERDICT_TTL.as_secs();
    assert_eq!(cache.fresh("openai", "gpt-x", expired), None);
}

#[test]
fn verdicts_survive_a_restart() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("model-probes.json");
    let levels = vec!["none".to_string(), "low".to_string()];
    ModelProbes::persisted(path.clone()).remember(
        "openai",
        &[("gpt-y".into(), Verdict::Reasoning { levels: levels.clone() })],
        5,
    );
    assert_eq!(
        ModelProbes::persisted(path).fresh("openai", "gpt-y", 5),
        Some(Verdict::Reasoning { levels })
    );
}

#[test]
fn an_unreadable_cache_is_a_cold_start() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("model-probes.json");
    std::fs::write(&path, "{не json").expect("write");
    assert_eq!(ModelProbes::persisted(path).fresh("openai", "gpt-y", 0), None);
}
