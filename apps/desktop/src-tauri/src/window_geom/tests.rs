use super::*;

#[test]
fn keeps_x_when_window_fits() {
    assert_eq!(clamp_window_x(100, 760, 0, 1920), 100);
}

#[test]
fn shifts_left_when_overflowing_right_edge() {
    assert_eq!(clamp_window_x(1600, 760, 0, 1920), 1160);
}

#[test]
fn clamps_to_left_when_wider_than_monitor() {
    assert_eq!(clamp_window_x(50, 2000, 0, 1920), 0);
}

#[test]
fn respects_negative_monitor_origin() {
    assert_eq!(clamp_window_x(-100, 760, -1920, 1920), -760);
}

#[test]
fn keeps_window_size_that_fits_the_work_area() {
    assert_eq!(clamp_window_size(960.0, 700.0, 1512.0, 944.0), (960.0, 700.0));
}

#[test]
fn trims_window_to_the_work_area_on_both_axes() {
    assert_eq!(clamp_window_size(1540.0, 1100.0, 1512.0, 944.0), (1512.0, 944.0));
}

#[test]
fn leaves_the_mini_capsule_alone() {
    assert_eq!(clamp_window_size(168.0, 48.0, 1512.0, 944.0), (168.0, 48.0));
}

#[test]
fn target_outer_width_keeps_the_invisible_windows_frame() {
    assert_eq!(target_outer_width(960, 960, 976), 976);
}

#[test]
fn target_outer_width_does_not_underflow_when_outer_is_smaller() {
    assert_eq!(target_outer_width(960, 976, 960), 960);
}
