use super::*;

#[test]
fn granted_flag_maps_to_state() {
    assert_eq!(state_from_granted(true), PermissionState::Granted);
    assert_eq!(state_from_granted(false), PermissionState::Denied);
}

#[test]
fn states_serialize_in_snake_case_for_the_front() {
    let json = serde_json::to_string(&PermissionsStatus {
        audio: PermissionState::Unknown,
        microphone: PermissionState::Unknown,
        screen: PermissionState::Granted,
    })
    .unwrap();
    assert_eq!(
        json,
        r#"{"audio":"unknown","microphone":"unknown","screen":"granted"}"#
    );
}

#[test]
fn kind_parses_from_front_payload() {
    let audio: PermissionKind = serde_json::from_str("\"audio\"").unwrap();
    let screen: PermissionKind = serde_json::from_str("\"screen\"").unwrap();
    assert_eq!(audio, PermissionKind::Audio);
    assert_eq!(screen, PermissionKind::Screen);
    assert!(serde_json::from_str::<PermissionKind>("\"camera\"").is_err());
}
