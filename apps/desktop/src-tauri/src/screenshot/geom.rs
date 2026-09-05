//! Геометрия оверлея выделения области: прямоугольники в пикселях экрана,
//! грязная область перерисовки, распаковка координат указателя, строки кропа.
//!
//! Платформенно-нейтрально намеренно: Windows-бэкенд оверлея тестами не
//! покрыт нигде (тестовый бинарь на windows-раннере не стартует), поэтому всё,
//! что можно проверить без Win32, живёт здесь и гоняется на macOS.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }

    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
}

/// Прямоугольник по двум углам в любом порядке.
pub fn normalized_rect(anchor: Point, pointer: Point) -> Rect {
    Rect {
        left: anchor.x.min(pointer.x),
        top: anchor.y.min(pointer.y),
        right: anchor.x.max(pointer.x),
        bottom: anchor.y.max(pointer.y),
    }
}

pub fn non_empty(area: Rect) -> Option<Rect> {
    (area.right > area.left && area.bottom > area.top).then_some(area)
}

pub fn inflated(area: Rect, amount: i32) -> Rect {
    Rect {
        left: area.left - amount,
        top: area.top - amount,
        right: area.right + amount,
        bottom: area.bottom + amount,
    }
}

pub fn union_of(first: Rect, second: Rect) -> Rect {
    Rect {
        left: first.left.min(second.left),
        top: first.top.min(second.top),
        right: first.right.max(second.right),
        bottom: first.bottom.max(second.bottom),
    }
}

pub fn intersection(first: Rect, second: Rect) -> Option<Rect> {
    non_empty(Rect {
        left: first.left.max(second.left),
        top: first.top.max(second.top),
        right: first.right.min(second.right),
        bottom: first.bottom.min(second.bottom),
    })
}

/// Что перерисовать между двумя состояниями выделения: объединение старой и
/// новой рамок, каждая расширена на толщину рамки.
pub fn dirty_area(previous: Option<Rect>, current: Option<Rect>, frame_thickness: i32) -> Option<Rect> {
    let previous = previous.map(|area| inflated(area, frame_thickness));
    let current = current.map(|area| inflated(area, frame_thickness));
    match (previous, current) {
        (Some(before), Some(after)) => Some(union_of(before, after)),
        (Some(before), None) => Some(before),
        (None, Some(after)) => Some(after),
        (None, None) => None,
    }
}

/// Точка, зажатая в границы экрана (правая и нижняя границы включительно —
/// это координаты углов, а не пикселей).
pub fn clamp_point(point: Point, width: i32, height: i32) -> Point {
    Point { x: point.x.clamp(0, width), y: point.y.clamp(0, height) }
}

/// Выделение принято, если оно не меньше `min_side` по обеим сторонам.
pub fn accepted(area: Option<Rect>, min_side: i32) -> Option<Rect> {
    area.filter(|area| area.width() >= min_side && area.height() >= min_side)
}

/// Координаты из `LPARAM` мышиного сообщения: младшее слово — x, старшее — y,
/// оба знаковые (`GET_X_LPARAM`/`GET_Y_LPARAM`), потому что на виртуальном
/// экране с монитором слева от главного они отрицательные.
pub fn unpack_pointer(packed: u32) -> Point {
    Point {
        x: i32::from((packed & 0xFFFF) as u16 as i16),
        y: i32::from(((packed >> 16) & 0xFFFF) as u16 as i16),
    }
}

/// Байтовый диапазон строки `row` области `area` в буфере с шагом `stride`
/// байт на строку и `channels` байт на пиксель.
pub fn row_byte_range(area: Rect, row: usize, stride: usize, channels: usize) -> std::ops::Range<usize> {
    let start = (area.top as usize + row) * stride + area.left as usize * channels;
    start..start + area.width() as usize * channels
}

#[cfg(test)]
mod tests;
