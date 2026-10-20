use super::*;
use crate::llm::test_support::{assistant, image, user, user_with_images};
use crate::llm::{registry, Effort, SseParser, PROVIDER_OPENAI};

fn spec_of(id: &str) -> &'static registry::LlmProviderSpec {
    registry::spec(id).expect("вендор объявлен в реестре")
}

/// Every vendor whose row declares this dialect. New rows join automatically —
/// that is the point of the dialect being data.
fn responses_specs() -> Vec<&'static registry::LlmProviderSpec> {
    registry::PROVIDERS
        .iter()
        .filter(|p| matches!(p.wire, registry::LlmWire::Responses { .. }))
        .collect()
}

#[test]
fn every_vendor_of_this_dialect_has_a_tagged_catalogue() {
    for spec in responses_specs() {
        let models = spec.models();
        assert!(!models.is_empty(), "у {} пустой каталог", spec.id);
        assert!(models.iter().all(|m| m.provider == spec.id));
    }
    let ids: Vec<&str> = responses_specs().iter().map(|p| p.id).collect();
    assert!(ids.contains(&PROVIDER_OPENAI));
}

#[test]
fn the_effort_sent_is_the_one_the_vendor_declared() {
    // Measured against the live API: OpenAI takes "none". A vendor added with
    // the wrong floor here fails loudly at that vendor.
    for spec in responses_specs() {
        let registry::LlmWire::Responses {
            effort_off,
            effort_on,
            ..
        } = spec.wire
        else {
            unreachable!()
        };
        let info = spec
            .models()
            .into_iter()
            .find(|m| !m.always_thinks)
            .expect("есть adaptive");
        assert_eq!(
            reasoning_value(spec, Some(&info), false, None),
            Some(json!({ "effort": effort_off })),
            "«выкл» у {}",
            spec.id
        );
        assert_eq!(
            reasoning_value(spec, Some(&info), true, None),
            Some(json!({ "effort": effort_on })),
            "«вкл» у {}",
            spec.id
        );
    }
}

#[test]
fn an_always_reasoning_model_never_gets_the_off_value() {
    let spec = spec_of(PROVIDER_OPENAI);
    let registry::LlmWire::Responses { effort_off, .. } = spec.wire else {
        unreachable!()
    };
    for always in spec.models().into_iter().filter(|m| m.always_thinks) {
        // gpt-5.5-pro refuses "none": with the toggle off it still gets its
        // default level, the one the picker shows checked.
        let sent = reasoning_value(spec, Some(&always), false, None);
        assert_ne!(sent, Some(json!({ "effort": effort_off })), "{}", always.id);
        assert_eq!(
            sent,
            always.default_effort.map(|e| json!({ "effort": e.as_str() })),
            "{}",
            always.id
        );
    }
}

#[test]
fn web_search_tool_is_sent_only_on_request() {
    assert_eq!(web_search_value(false), None);
    assert_eq!(
        web_search_value(true),
        Some(json!({"type": WEB_SEARCH_TOOL_TYPE}))
    );
}

#[test]
fn request_body_puts_system_into_instructions_and_never_stores() {
    let body = build_request_body(
        "gpt-5.6-terra",
        "будь краток",
        &[user("привет")],
        None,
        None,
    );
    assert_eq!(body["instructions"], "будь краток");
    assert_eq!(body["store"], false);
    assert_eq!(body["stream"], true);
    assert_eq!(body["input"][0]["content"][0]["type"], CONTENT_INPUT_TEXT);
}

#[test]
fn assistant_turns_use_output_text_and_user_turns_input_text() {
    let body = build_request_body(
        "gpt-5.6-terra",
        "",
        &[user("вопрос"), assistant("ответ"), user("ещё")],
        None,
        None,
    );
    assert_eq!(body["input"][0]["content"][0]["type"], CONTENT_INPUT_TEXT);
    assert_eq!(body["input"][1]["content"][0]["type"], CONTENT_OUTPUT_TEXT);
    assert_eq!(body["input"][2]["content"][0]["type"], CONTENT_INPUT_TEXT);
}

#[test]
fn empty_messages_are_dropped_from_input() {
    let body = build_request_body("gpt-5.6-terra", "", &[user(""), user("текст")], None, None);
    assert_eq!(body["input"].as_array().unwrap().len(), 1);
    assert_eq!(body["input"][0]["content"][0]["text"], "текст");
}

#[test]
fn images_travel_as_data_urls() {
    let m = user_with_images("что тут", vec![image("image/png", "QUJD")]);
    let body = build_request_body("gpt-5.6-terra", "", &[m], None, None);
    let content = &body["input"][0]["content"];
    assert_eq!(content[0]["type"], CONTENT_INPUT_TEXT);
    assert_eq!(content[1]["type"], CONTENT_INPUT_IMAGE);
    assert_eq!(content[1]["image_url"], "data:image/png;base64,QUJD");
}

/// Полный кадр SSE (с `event:`-строкой) проходит через общий фреймер, а
/// блок-парсер диалекта получает уже склеенную нагрузку `data:`.
#[test]
fn text_deltas_are_parsed() {
    let mut parser = SseParser::with_block_parser(parse_block);
    let frame = "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"при\"}\n\n";
    assert_eq!(parser.feed(frame), vec![SseOut::TextDelta("при".into())]);
}

#[test]
fn completed_event_ends_the_stream_with_or_without_usage() {
    for data in [
        r#"{"type":"response.completed","response":{"usage":{"input_tokens":41}}}"#,
        r#"{"type":"response.completed","response":{}}"#,
    ] {
        assert_eq!(parse_block(data), vec![SseOut::Done]);
    }
}

#[test]
fn failed_response_surfaces_the_api_message() {
    let data = r#"{"type":"response.failed","response":{"error":{"code":"invalid_prompt","message":"нельзя"}}}"#;
    assert_eq!(parse_block(data), vec![SseOut::ApiError("нельзя".into())]);
}

#[test]
fn a_failure_worth_retrying_is_reported_as_such() {
    let data = r#"{"type":"response.failed","response":{"error":{"code":"server_error","message":"перегрузка"}}}"#;
    assert_eq!(
        parse_block(data),
        vec![SseOut::Retryable {
            code: 500,
            message: "перегрузка".into()
        }]
    );
}

#[test]
fn incomplete_response_surfaces_its_reason() {
    let data = r#"{"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}"#;
    assert_eq!(
        parse_block(data),
        vec![SseOut::Incomplete("max_output_tokens".into())]
    );
}

#[test]
fn unrelated_events_are_ignored() {
    let data = r#"{"type":"response.in_progress","response":{}}"#;
    assert_eq!(parse_block(data), Vec::<SseOut>::new());
}

#[test]
fn a_chosen_effort_replaces_effort_on_only_while_reasoning() {
    for spec in responses_specs() {
        let registry::LlmWire::Responses { effort_off, .. } = spec.wire else {
            unreachable!()
        };
        for info in spec.models().into_iter().filter(|m| !m.always_thinks) {
            for &effort in &info.efforts {
                assert_eq!(
                    reasoning_value(spec, Some(&info), true, Some(effort)),
                    Some(json!({ "effort": effort.as_str() })),
                    "{} {}",
                    info.id,
                    effort.as_str()
                );
                // Thinking off stays the vendor's own "off" value.
                assert_eq!(
                    reasoning_value(spec, Some(&info), false, Some(effort)),
                    Some(json!({ "effort": effort_off })),
                    "{}",
                    info.id
                );
            }
        }
    }
}

#[test]
fn a_level_the_model_refuses_is_never_sent() {
    let spec = spec_of(PROVIDER_OPENAI);
    let mini = spec
        .models()
        .into_iter()
        .find(|m| m.id == "gpt-5.4-mini")
        .unwrap();
    assert!(
        !mini.efforts.contains(&Effort::Max),
        "gpt-5.4-mini отвергает max — измерено"
    );
    let registry::LlmWire::Responses { effort_on, .. } = spec.wire else {
        unreachable!()
    };
    assert_eq!(
        reasoning_value(spec, Some(&mini), true, Some(Effort::Max)),
        Some(json!({ "effort": effort_on }))
    );
}

#[test]
fn an_always_reasoning_model_gets_a_level_only_when_one_was_picked() {
    let spec = spec_of(PROVIDER_OPENAI);
    let always = spec
        .models()
        .into_iter()
        .find(|m| m.id == "gpt-5.5-pro")
        .unwrap();
    assert!(always.always_thinks);
    // gpt-5.5-pro: medium/high/xhigh, measured; the toggle is irrelevant to it.
    assert_eq!(
        reasoning_value(spec, Some(&always), false, Some(Effort::High)),
        Some(json!({"effort": "high"}))
    );
    // A level it refuses: its default instead, never a 400.
    assert_eq!(
        reasoning_value(spec, Some(&always), true, Some(Effort::Low)),
        Some(json!({"effort": "medium"}))
    );
}

#[test]
fn a_model_that_does_not_reason_never_gets_the_field() {
    let spec = spec_of(PROVIDER_OPENAI);
    let plain = ModelInfo {
        id: "gpt-4o".into(),
        display_name: "GPT-4o".into(),
        provider: PROVIDER_OPENAI.into(),
        adaptive: false,
        always_thinks: false,
        code_exec: true,
        efforts: Vec::new(),
        budget_thinking: false,
        default_effort: None,
    };
    // gpt-4o answers any `reasoning` — "none" included — with a 400.
    for requested in [false, true] {
        assert_eq!(
            reasoning_value(spec, Some(&plain), requested, Some(Effort::High)),
            None
        );
    }
}

fn live(id: &str, created: i64) -> LiveModel {
    LiveModel {
        id: id.into(),
        created,
    }
}

#[test]
fn the_live_list_is_newest_first_without_pinned_snapshots() {
    let ids = newest_first_without_snapshots(vec![
        live("gpt-4o", 10),
        live("gpt-4o-2024-08-06", 9),
        live("gpt-4-0613", 1),
        live("gpt-4", 2),
        live("gpt-6-sol", 30),
        live("gpt-3.5-turbo-16k", 3),
        // A dated id whose alias the key does not list is the only way to it.
        live("o9-2027-01-01", 20),
    ]);
    assert_eq!(
        ids,
        ["gpt-6-sol", "o9-2027-01-01", "gpt-4o", "gpt-3.5-turbo-16k", "gpt-4"]
    );
}

#[test]
fn display_names_are_derived_from_ids() {
    for (id, name) in [
        ("gpt-6.1-sol", "GPT-6.1 Sol"),
        ("gpt-5.4-mini", "GPT-5.4 Mini"),
        ("gpt-4o", "GPT-4o"),
        ("gpt-live-1", "GPT Live 1"),
        ("gpt-3.5-turbo-16k", "GPT-3.5 Turbo 16k"),
        ("o3-mini", "o3 Mini"),
        ("chat-latest", "Chat Latest"),
    ] {
        assert_eq!(display_name_from_id(id), name);
    }
}

mod listing {
    use super::*;
    use wiremock::matchers::{body_partial_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn refusal(status: u16, code: &str, param: Option<&str>, message: &str) -> ResponseTemplate {
        ResponseTemplate::new(status).set_body_json(json!({
            "error": {"code": code, "param": param, "message": message}
        }))
    }

    async fn answer_probe(server: &MockServer, model: &str, reply: ResponseTemplate) {
        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .and(body_partial_json(json!({"model": model})))
            .respond_with(reply)
            .expect(1)
            .mount(server)
            .await;
    }

    async fn server_listing(models: Value) -> MockServer {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": models })))
            .mount(&server)
            .await;
        server
    }

    fn client(server: &MockServer) -> ResponsesClient {
        ResponsesClient::direct(spec_of(PROVIDER_OPENAI), "sk-test".into())
            .with_base_url(server.uri())
    }

    #[tokio::test]
    async fn every_chat_model_is_listed_with_what_the_api_said_about_it() {
        let server = server_listing(json!([
            {"id": "gpt-new", "created": 30},
            {"id": "gpt-plain", "created": 20},
            {"id": "tts-1", "created": 10},
        ]))
        .await;
        answer_probe(
            &server,
            "gpt-new",
            refusal(
                400,
                "unsupported_value",
                Some("reasoning.effort"),
                "Unsupported value: 'minimal' is not supported with the 'gpt-new' model. \
                 Supported values are: 'none', 'low', 'medium', and 'max'.",
            ),
        )
        .await;
        answer_probe(
            &server,
            "gpt-plain",
            refusal(
                400,
                "unsupported_parameter",
                Some("reasoning.effort"),
                "Unsupported parameter: 'reasoning.effort' is not supported with this model.",
            ),
        )
        .await;
        answer_probe(
            &server,
            "tts-1",
            refusal(404, "model_not_found", None, "The model `tts-1` does not exist."),
        )
        .await;

        let client = client(&server);
        let models = client.list_models().await.unwrap();
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["gpt-new", "gpt-plain"], "tts-1 не чат — его нет");

        let new = &models[0];
        assert!(new.adaptive && !new.always_thinks, "умеет «none» — тумблер жив");
        assert_eq!(new.efforts, [Effort::Low, Effort::Medium, Effort::Max]);
        assert_eq!(new.display_name, "GPT New");
        let plain = &models[1];
        assert!(!plain.adaptive && !plain.always_thinks && plain.efforts.is_empty());

        // The second listing asks nothing: `.expect(1)` on every probe above.
        assert_eq!(client.list_models().await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_model_that_cannot_stop_reasoning_always_thinks() {
        let server = server_listing(json!([{"id": "gpt-deep", "created": 1}])).await;
        answer_probe(
            &server,
            "gpt-deep",
            refusal(
                400,
                "unsupported_value",
                Some("reasoning.effort"),
                "Unsupported value: 'minimal' is not supported with the 'gpt-deep' model. \
                 Supported values are: 'medium', 'high', and 'xhigh'.",
            ),
        )
        .await;
        let models = client(&server).list_models().await.unwrap();
        assert!(models[0].always_thinks);
        assert_eq!(
            models[0].efforts,
            [Effort::Medium, Effort::High, Effort::Xhigh]
        );
    }

    #[tokio::test]
    async fn the_gpt5_line_takes_minimal_and_is_read_on_the_second_level() {
        let server = server_listing(json!([{"id": "gpt-5", "created": 1}])).await;
        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .and(body_partial_json(json!({"reasoning": {"effort": "minimal"}})))
            .respond_with(refusal(
                400,
                "unsupported_parameter",
                Some("temperature"),
                "Unsupported parameter: 'temperature' is not supported with this model.",
            ))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .and(body_partial_json(json!({"reasoning": {"effort": "max"}})))
            .respond_with(refusal(
                400,
                "unsupported_value",
                Some("reasoning.effort"),
                "Unsupported value: 'max' is not supported with the 'gpt-5' model. \
                 Supported values are: 'minimal', 'low', 'medium', and 'high'.",
            ))
            .expect(1)
            .mount(&server)
            .await;
        let models = client(&server).list_models().await.unwrap();
        assert!(models[0].always_thinks, "без «none» выключить нельзя");
        assert_eq!(
            models[0].efforts,
            [Effort::Low, Effort::Medium, Effort::High],
            "minimal — не ступень нашей лестницы"
        );
    }

    #[tokio::test]
    async fn without_a_verdict_only_the_offline_table_vouches_for_a_model() {
        let server = server_listing(json!([
            {"id": "gpt-5.4-mini", "created": 2},
            {"id": "gpt-mystery", "created": 1},
        ]))
        .await;
        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        let models = client(&server).list_models().await.unwrap();
        let measured = spec_of(PROVIDER_OPENAI)
            .models()
            .into_iter()
            .find(|m| m.id == "gpt-5.4-mini")
            .unwrap();
        assert_eq!(models, [measured]);
    }

    #[tokio::test]
    async fn a_probed_model_keeps_its_capabilities_when_a_chat_sends_to_it() {
        let catalog: crate::llm::ModelCatalog = Arc::new(Mutex::new(vec![ModelInfo {
            id: "gpt-plain".into(),
            display_name: "GPT Plain".into(),
            provider: PROVIDER_OPENAI.into(),
            adaptive: false,
            always_thinks: false,
            code_exec: true,
            efforts: Vec::new(),
            budget_thinking: false,
            default_effort: None,
        }]));
        let client = ResponsesClient::direct(spec_of(PROVIDER_OPENAI), "sk-test".into())
            .with_catalog(catalog);
        let info = client.model_info("gpt-plain").expect("из живого каталога");
        assert_eq!(reasoning_value(client.spec, Some(&info), true, None), None);
    }
}
