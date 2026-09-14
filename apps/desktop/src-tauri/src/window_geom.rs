pub fn clamp_window_x(x: i32, width: u32, monitor_x: i32, monitor_width: u32) -> i32 {
    let max_x = monitor_x + monitor_width as i32 - width as i32;
    x.min(max_x).max(monitor_x)
}

pub fn clamp_window_size(
    width: f64,
    height: f64,
    available_width: f64,
    available_height: f64,
) -> (f64, f64) {
    (width.min(available_width), height.min(available_height))
}

/// Outer width the window will have at `target_inner_width`, carrying over
/// the current frame allowance (`outer - inner`, zero for frameless macOS).
pub fn target_outer_width(
    target_inner_width: u32,
    current_inner_width: u32,
    current_outer_width: u32,
) -> u32 {
    target_inner_width.saturating_add(current_outer_width.saturating_sub(current_inner_width))
}

#[cfg(test)]
mod tests;
