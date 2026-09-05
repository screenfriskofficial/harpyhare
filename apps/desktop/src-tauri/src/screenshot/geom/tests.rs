use super::*;

fn rect(left: i32, top: i32, right: i32, bottom: i32) -> Rect {
    Rect { left, top, right, bottom }
}

#[test]
fn a_selection_is_normalized_whichever_corner_came_first() {
    let a = Point { x: 10, y: 40 };
    let b = Point { x: 30, y: 20 };
    assert_eq!(normalized_rect(a, b), rect(10, 20, 30, 40));
    assert_eq!(normalized_rect(b, a), rect(10, 20, 30, 40));
}

#[test]
fn empty_and_negative_areas_are_not_selections() {
    assert_eq!(non_empty(rect(5, 5, 5, 9)), None);
    assert_eq!(non_empty(rect(5, 5, 9, 5)), None);
    assert_eq!(non_empty(rect(5, 5, 9, 9)), Some(rect(5, 5, 9, 9)));
}

#[test]
fn the_dirty_area_covers_both_frames_with_their_thickness() {
    let before = rect(10, 10, 20, 20);
    let after = rect(15, 15, 40, 40);
    assert_eq!(dirty_area(Some(before), Some(after), 2), Some(rect(8, 8, 42, 42)));
    assert_eq!(dirty_area(None, Some(after), 2), Some(rect(13, 13, 42, 42)));
    assert_eq!(dirty_area(Some(before), None, 1), Some(rect(9, 9, 21, 21)));
    assert_eq!(dirty_area(None, None, 1), None);
}

#[test]
fn intersection_is_empty_when_rects_do_not_overlap() {
    assert_eq!(intersection(rect(0, 0, 10, 10), rect(10, 10, 20, 20)), None);
    assert_eq!(intersection(rect(0, 0, 10, 10), rect(5, 5, 20, 20)), Some(rect(5, 5, 10, 10)));
}

#[test]
fn points_are_clamped_to_the_screen_corners_inclusive() {
    assert_eq!(clamp_point(Point { x: -5, y: 700 }, 640, 480), Point { x: 0, y: 480 });
    assert_eq!(clamp_point(Point { x: 640, y: 0 }, 640, 480), Point { x: 640, y: 0 });
}

#[test]
fn tiny_selections_are_rejected() {
    assert_eq!(accepted(Some(rect(0, 0, 2, 10)), 3), None);
    assert_eq!(accepted(Some(rect(0, 0, 3, 3)), 3), Some(rect(0, 0, 3, 3)));
    assert_eq!(accepted(None, 3), None);
}

/// Монитор слева от главного даёт отрицательные координаты: распаковка обязана
/// быть знаковой, как `GET_X_LPARAM`, а не `LOWORD`.
#[test]
fn pointer_coordinates_are_signed_words() {
    let packed = ((-7i16 as u16 as u32) << 16) | (-3i16 as u16 as u32);
    assert_eq!(unpack_pointer(packed), Point { x: -3, y: -7 });
    assert_eq!(unpack_pointer((20 << 16) | 10), Point { x: 10, y: 20 });
}

#[test]
fn crop_rows_index_into_the_source_buffer_by_stride() {
    let area = rect(2, 1, 5, 3);
    let stride = 8 * 4;
    assert_eq!(row_byte_range(area, 0, stride, 4), stride + 8..stride + 8 + 12);
    assert_eq!(row_byte_range(area, 1, stride, 4), 2 * stride + 8..2 * stride + 8 + 12);
}
