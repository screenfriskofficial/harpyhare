use super::*;

const CHAT: &str = "chat-1";
const OLD_STREAM: &str = "stream-old";
const NEW_STREAM: &str = "stream-new";

fn entry(stream_id: &str) -> ActiveLlmStream {
    ActiveLlmStream {
        stream_id: stream_id.to_string(),
        cancel: CancellationToken::new(),
    }
}

#[test]
fn take_stream_ignores_a_cancel_aimed_at_an_already_replaced_stream() {
    let mut map = StreamRegistry::new();
    replace_stream(&mut map, CHAT, entry(NEW_STREAM));
    assert!(take_stream(&mut map, CHAT, OLD_STREAM).is_none());
    assert!(map.contains_key(CHAT));
}

#[test]
fn take_stream_removes_only_its_own_stream() {
    let mut map = StreamRegistry::new();
    replace_stream(&mut map, CHAT, entry(OLD_STREAM));
    assert!(take_stream(&mut map, CHAT, OLD_STREAM).is_some());
    assert!(map.is_empty());
}

#[test]
fn replace_stream_hands_back_the_previous_stream_so_it_can_be_cancelled() {
    let mut map = StreamRegistry::new();
    replace_stream(&mut map, CHAT, entry(OLD_STREAM));
    let displaced = replace_stream(&mut map, CHAT, entry(NEW_STREAM)).expect("прежний стрим");
    assert_eq!(displaced.stream_id, OLD_STREAM);
    assert!(!displaced.cancel.is_cancelled());
    displaced.cancel.cancel();
    assert_eq!(map[CHAT].stream_id, NEW_STREAM);
}

#[test]
fn a_finished_old_stream_does_not_unregister_the_new_one() {
    let mut map = StreamRegistry::new();
    replace_stream(&mut map, CHAT, entry(OLD_STREAM));
    replace_stream(&mut map, CHAT, entry(NEW_STREAM));
    take_stream(&mut map, CHAT, OLD_STREAM);
    assert_eq!(map[CHAT].stream_id, NEW_STREAM);
}

#[test]
fn a_cancel_that_arrives_before_registration_still_cancels_that_stream() {
    // `cancel_stream` — синхронная команда, `send_to_claude` стартует на
    // рабочем потоке: «Стоп» может приехать раньше, чем стрим зарегистрирован.
    let mut map = StreamRegistry::new();
    cancel_in(&mut map, CHAT, NEW_STREAM);
    assert!(map[CHAT].cancel.is_cancelled(), "надгробие лежит уже отменённым");

    let token = register_in(&mut map, CHAT, NEW_STREAM);
    assert!(token.is_cancelled(), "запоздавшая регистрация видит надгробие");
    assert!(take_stream(&mut map, CHAT, NEW_STREAM).is_some(), "и снимает его как свой стрим");
    assert!(map.is_empty());
}

#[test]
fn a_tombstone_does_not_cancel_a_later_unrelated_stream() {
    let mut map = StreamRegistry::new();
    cancel_in(&mut map, CHAT, OLD_STREAM);
    let token = register_in(&mut map, CHAT, NEW_STREAM);
    assert!(!token.is_cancelled(), "чужое надгробие вытесняется, а не гасит новый стрим");
    assert_eq!(map[CHAT].stream_id, NEW_STREAM);
}

#[test]
fn a_cancel_for_a_foreign_stream_leaves_the_active_one_alone() {
    let mut map = StreamRegistry::new();
    let token = register_in(&mut map, CHAT, NEW_STREAM);
    cancel_in(&mut map, CHAT, OLD_STREAM);
    assert!(!token.is_cancelled());
    assert_eq!(map[CHAT].stream_id, NEW_STREAM, "надгробие не подменяет живой стрим");
}
