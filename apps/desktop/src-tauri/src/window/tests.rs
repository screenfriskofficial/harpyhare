use super::*;
use crate::hotkeys::HotkeyScope;

#[test]
fn global_scope_actions_and_the_registration_table_agree() {
    let registered: Vec<&str> = GLOBAL_HOTKEYS.iter().map(|(id, _)| *id).collect();

    for action in hotkeys::HOTKEY_ACTIONS {
        if action.scope != HotkeyScope::Global {
            continue;
        }
        assert!(
            registered.contains(&action.id),
            "глобальное действие {} не зарегистрировано в GLOBAL_HOTKEYS",
            action.id
        );
    }

    for id in registered {
        let action = hotkeys::action(id)
            .unwrap_or_else(|| panic!("{id} из GLOBAL_HOTKEYS отсутствует в реестре действий"));
        assert_eq!(
            action.scope,
            HotkeyScope::Global,
            "{id} регистрируется системным шорткатом, но в реестре не global"
        );
    }
}

#[test]
fn the_tween_starts_at_the_origin_frame_and_lands_exactly_on_the_target() {
    let tween = ResizeTween {
        from_width: 400.0,
        to_width: 800.0,
        from_height: 300.0,
        to_height: 500.0,
        from_x: 100,
        to_x: 40,
        y: 12,
    };
    let (w, h, x) = tween_frame(&tween, RESIZE_TWEEN_STEPS);
    assert!((w - 800.0).abs() < 1e-9 && (h - 500.0).abs() < 1e-9);
    assert_eq!(x, 40, "последний кадр стоит ровно на цели");
    let (w1, h1, x1) = tween_frame(&tween, 1);
    assert!(w1 > 400.0 && w1 < 800.0 && h1 > 300.0 && h1 < 500.0);
    assert!(x1 < 100 && x1 > 40, "ease-out: первый кадр уже сдвинулся, но не доехал");
    let mut last = 0.0;
    for step in 1..=RESIZE_TWEEN_STEPS {
        let (w, _, _) = tween_frame(&tween, step);
        assert!(w >= last, "ширина растёт монотонно");
        last = w;
    }
}
