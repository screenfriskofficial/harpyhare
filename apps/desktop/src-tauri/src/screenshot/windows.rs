use std::ffi::c_void;
use std::sync::OnceLock;

use png::{BitDepth, ColorType, Compression, Encoder};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, CreateCompatibleDC, CreateDIBSection, CreateSolidBrush, DeleteDC,
    DeleteObject, EndPaint, FrameRect, GdiFlush, GetDC, InvalidateRect, ReleaseDC, SelectObject,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ,
    PAINTSTRUCT, SRCCOPY,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{SetFocus, VK_ESCAPE};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
    GetSystemMetrics, GetWindowLongPtrW, LoadCursorW, RegisterClassW, SetForegroundWindow,
    SetWindowLongPtrW, ShowWindow, TranslateMessage, CREATESTRUCTW, GWLP_USERDATA, IDC_CROSS, MSG,
    SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SW_SHOW,
    WM_ERASEBKGND, WM_KEYDOWN, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_NCCREATE, WM_PAINT,
    WM_RBUTTONDOWN, WNDCLASSW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

use super::geom::{self, Point as GeomPoint, Rect as GeomRect};

const OVERLAY_CLASS_NAME: PCWSTR = w!("HarpyRegionCaptureOverlay");
const OVERLAY_WINDOW_TITLE: PCWSTR = w!("");
const UNREGISTERED_CLASS_ATOM: u16 = 0;

const VEIL_STRENGTH_PERCENT: u32 = 45;
const FULL_PERCENT: u32 = 100;

const FRAME_THICKNESS_PX: i32 = 2;
const FRAME_RED: u32 = 217;
const FRAME_GREEN: u32 = 51;
const FRAME_BLUE: u32 = 51;
const GREEN_CHANNEL_SHIFT: u32 = 8;
const BLUE_CHANNEL_SHIFT: u32 = 16;
const FRAME_COLOR: COLORREF =
    COLORREF(FRAME_RED | (FRAME_GREEN << GREEN_CHANNEL_SHIFT) | (FRAME_BLUE << BLUE_CHANNEL_SHIFT));

const MIN_SELECTION_PX: i32 = 3;

const BITS_PER_PIXEL: u16 = 32;
const COLOR_PLANES: u16 = 1;
const SOURCE_CHANNELS: usize = 4;
const OUTPUT_CHANNELS: usize = 3;
const CHANNEL_BLUE: usize = 0;
const CHANNEL_GREEN: usize = 1;
const CHANNEL_RED: usize = 2;
const DIB_SECTION_OFFSET: u32 = 0;

const MESSAGE_HANDLED: isize = 0;
const ERASE_HANDLED: isize = 1;
const NO_MESSAGE_FILTER: u32 = 0;
const MESSAGE_LOOP_END: i32 = 0;
const REDRAW_WITHOUT_ERASE: bool = false;
const FIRST_FRAME_RING: i32 = 1;

const SCREEN_DC_FAILED: &str = "нет доступа к экрану";
const CANVAS_FAILED: &str = "не удалось выделить буфер снимка";
const SCREEN_EMPTY: &str = "экран пустой";
const SCREEN_COPY_FAILED: &str = "не удалось снять экран";
const CLASS_FAILED: &str = "не удалось создать класс оверлея";
const WINDOW_FAILED: &str = "не удалось создать окно выделения";
const PNG_ENCODE_FAILED: &str = "не удалось закодировать PNG";

/// DPI-awareness процесса выставляет tao при создании цикла событий (per-monitor
/// v2); менять её посреди процесса нельзя, и прежний вызов здесь всегда падал
/// и игнорировался — координаты виртуального экрана и так физические.
pub fn capture_region() -> Result<Option<Vec<u8>>, String> {
    let bounds = virtual_screen_bounds()?;
    let screen = ScreenDc::open()?;
    let original = capture_virtual_screen(&screen, &bounds)?;
    let dimmed = dimmed_copy(&original, screen.handle())?;
    let back = Canvas::create(screen.handle(), bounds.width, bounds.height)?;
    match run_overlay(&original, &dimmed, &back, &bounds)? {
        Some(area) => crop_to_png(&original, area).map(Some),
        None => Ok(None),
    }
}

struct VirtualScreen {
    origin: POINT,
    width: i32,
    height: i32,
}

fn virtual_screen_bounds() -> Result<VirtualScreen, String> {
    let bounds = unsafe {
        VirtualScreen {
            origin: POINT {
                x: GetSystemMetrics(SM_XVIRTUALSCREEN),
                y: GetSystemMetrics(SM_YVIRTUALSCREEN),
            },
            width: GetSystemMetrics(SM_CXVIRTUALSCREEN),
            height: GetSystemMetrics(SM_CYVIRTUALSCREEN),
        }
    };
    if bounds.width <= 0 || bounds.height <= 0 {
        return Err(SCREEN_EMPTY.to_string());
    }
    Ok(bounds)
}

struct ScreenDc(HDC);

impl ScreenDc {
    fn open() -> Result<Self, String> {
        let dc = unsafe { GetDC(None) };
        if dc.is_invalid() {
            return Err(SCREEN_DC_FAILED.to_string());
        }
        Ok(Self(dc))
    }

    fn handle(&self) -> HDC {
        self.0
    }
}

impl Drop for ScreenDc {
    fn drop(&mut self) {
        unsafe {
            ReleaseDC(None, self.0);
        }
    }
}

struct Canvas {
    dc: HDC,
    bitmap: HBITMAP,
    replaced: HGDIOBJ,
    bits: *mut u8,
    width: i32,
    height: i32,
}

impl Canvas {
    fn create(reference: HDC, width: i32, height: i32) -> Result<Self, String> {
        let dc = unsafe { CreateCompatibleDC(Some(reference)) };
        if dc.is_invalid() {
            return Err(CANVAS_FAILED.to_string());
        }
        let description = top_down_bgra_description(width, height);
        let mut bits: *mut c_void = std::ptr::null_mut();
        let created = unsafe {
            CreateDIBSection(
                Some(reference),
                &description,
                DIB_RGB_COLORS,
                &mut bits,
                None,
                DIB_SECTION_OFFSET,
            )
        };
        let Ok(bitmap) = created else {
            unsafe {
                let _ = DeleteDC(dc);
            }
            return Err(CANVAS_FAILED.to_string());
        };
        if bits.is_null() {
            unsafe {
                let _ = DeleteObject(bitmap.into());
                let _ = DeleteDC(dc);
            }
            return Err(CANVAS_FAILED.to_string());
        }
        let replaced = unsafe { SelectObject(dc, bitmap.into()) };
        Ok(Self {
            dc,
            bitmap,
            replaced,
            bits: bits.cast(),
            width,
            height,
        })
    }

    fn byte_len(&self) -> usize {
        self.width as usize * self.height as usize * SOURCE_CHANNELS
    }

    fn pixels(&self) -> &[u8] {
        unsafe { std::slice::from_raw_parts(self.bits, self.byte_len()) }
    }

    fn pixels_mut(&mut self) -> &mut [u8] {
        unsafe { std::slice::from_raw_parts_mut(self.bits, self.byte_len()) }
    }
}

impl Drop for Canvas {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.replaced);
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.dc);
        }
    }
}

fn top_down_bgra_description(width: i32, height: i32) -> BITMAPINFO {
    BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: COLOR_PLANES,
            biBitCount: BITS_PER_PIXEL,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    }
}

fn capture_virtual_screen(screen: &ScreenDc, bounds: &VirtualScreen) -> Result<Canvas, String> {
    let canvas = Canvas::create(screen.handle(), bounds.width, bounds.height)?;
    unsafe {
        BitBlt(
            canvas.dc,
            0,
            0,
            bounds.width,
            bounds.height,
            Some(screen.handle()),
            bounds.origin.x,
            bounds.origin.y,
            SRCCOPY | CAPTUREBLT,
        )
        .map_err(|_| SCREEN_COPY_FAILED.to_string())?;
        let _ = GdiFlush();
    }
    Ok(canvas)
}

fn dimmed_copy(source: &Canvas, reference: HDC) -> Result<Canvas, String> {
    let mut dimmed = Canvas::create(reference, source.width, source.height)?;
    let kept_percent = FULL_PERCENT - VEIL_STRENGTH_PERCENT;
    let original = source.pixels();
    for (veiled, sample) in dimmed.pixels_mut().iter_mut().zip(original.iter()) {
        *veiled = (u32::from(*sample) * kept_percent / FULL_PERCENT) as u8;
    }
    Ok(dimmed)
}

#[derive(Clone, Copy, PartialEq)]
enum Outcome {
    Active,
    Confirmed,
    Cancelled,
}

struct Overlay {
    original: HDC,
    dimmed: HDC,
    back: HDC,
    width: i32,
    height: i32,
    anchor: POINT,
    pointer: POINT,
    dragging: bool,
    started: bool,
    outcome: Outcome,
}

impl Overlay {
    fn new(original: &Canvas, dimmed: &Canvas, back: &Canvas, bounds: &VirtualScreen) -> Self {
        Self {
            original: original.dc,
            dimmed: dimmed.dc,
            back: back.dc,
            width: bounds.width,
            height: bounds.height,
            anchor: POINT::default(),
            pointer: POINT::default(),
            dragging: false,
            started: false,
            outcome: Outcome::Active,
        }
    }

    fn selection(&self) -> Option<GeomRect> {
        if !self.started {
            return None;
        }
        geom::non_empty(geom::normalized_rect(as_geom_point(self.anchor), as_geom_point(self.pointer)))
    }

    fn accepted(&self) -> Option<GeomRect> {
        geom::accepted(self.selection(), MIN_SELECTION_PX)
    }

    fn inside(&self, point: POINT) -> POINT {
        as_win_point(geom::clamp_point(as_geom_point(point), self.width, self.height))
    }

    fn begin(&mut self, point: POINT) {
        let point = self.inside(point);
        self.anchor = point;
        self.pointer = point;
        self.started = true;
        self.dragging = true;
    }

    fn drag(&mut self, point: POINT) {
        self.pointer = self.inside(point);
    }

    fn finish(&mut self, point: POINT) {
        self.drag(point);
        self.dragging = false;
        self.outcome = match self.accepted() {
            Some(_) => Outcome::Confirmed,
            None => Outcome::Cancelled,
        };
    }

    fn cancel(&mut self) {
        self.outcome = Outcome::Cancelled;
    }
}

fn as_geom_point(point: POINT) -> GeomPoint {
    GeomPoint { x: point.x, y: point.y }
}

fn as_win_point(point: GeomPoint) -> POINT {
    POINT { x: point.x, y: point.y }
}

fn as_geom_rect(area: RECT) -> GeomRect {
    GeomRect { left: area.left, top: area.top, right: area.right, bottom: area.bottom }
}

fn as_win_rect(area: GeomRect) -> RECT {
    RECT { left: area.left, top: area.top, right: area.right, bottom: area.bottom }
}

fn pointer_position(lparam: LPARAM) -> POINT {
    as_win_point(geom::unpack_pointer(lparam.0 as u32))
}

fn request_redraw(window: HWND, area: Option<GeomRect>) {
    let Some(area) = area.map(as_win_rect) else {
        return;
    };
    unsafe {
        let _ = InvalidateRect(Some(window), Some(&area), REDRAW_WITHOUT_ERASE);
    }
}

fn register_overlay_class() -> u16 {
    let Ok(instance) = (unsafe { GetModuleHandleW(None) }) else {
        return UNREGISTERED_CLASS_ATOM;
    };
    let Ok(cursor) = (unsafe { LoadCursorW(None, IDC_CROSS) }) else {
        return UNREGISTERED_CLASS_ATOM;
    };
    let class = WNDCLASSW {
        lpfnWndProc: Some(overlay_proc),
        hInstance: instance.into(),
        hCursor: cursor,
        lpszClassName: OVERLAY_CLASS_NAME,
        ..Default::default()
    };
    unsafe { RegisterClassW(&class) }
}

fn ensure_overlay_class() -> Result<(), String> {
    static OVERLAY_CLASS_ATOM: OnceLock<u16> = OnceLock::new();
    let atom = OVERLAY_CLASS_ATOM.get_or_init(register_overlay_class);
    if *atom == UNREGISTERED_CLASS_ATOM {
        return Err(CLASS_FAILED.to_string());
    }
    Ok(())
}

struct OverlayWindow(HWND);

impl OverlayWindow {
    fn open(bounds: &VirtualScreen, state: *mut Overlay) -> Result<Self, String> {
        ensure_overlay_class()?;
        let instance = unsafe { GetModuleHandleW(None) }.map_err(|_| WINDOW_FAILED.to_string())?;
        let window = unsafe {
            CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
                OVERLAY_CLASS_NAME,
                OVERLAY_WINDOW_TITLE,
                WS_POPUP,
                bounds.origin.x,
                bounds.origin.y,
                bounds.width,
                bounds.height,
                None,
                None,
                Some(instance.into()),
                Some(state.cast()),
            )
        }
        .map_err(|_| WINDOW_FAILED.to_string())?;
        Ok(Self(window))
    }

    fn present(&self) {
        unsafe {
            let _ = ShowWindow(self.0, SW_SHOW);
            let _ = SetForegroundWindow(self.0);
            let _ = SetFocus(Some(self.0));
        }
    }
}

impl Drop for OverlayWindow {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.0);
        }
    }
}

fn run_overlay(
    original: &Canvas,
    dimmed: &Canvas,
    back: &Canvas,
    bounds: &VirtualScreen,
) -> Result<Option<GeomRect>, String> {
    let mut state = Overlay::new(original, dimmed, back, bounds);
    let handle: *mut Overlay = &mut state;
    let window = OverlayWindow::open(bounds, handle)?;
    window.present();
    pump_messages(handle);
    drop(window);
    match state.outcome {
        Outcome::Confirmed => Ok(state.accepted()),
        Outcome::Active | Outcome::Cancelled => Ok(None),
    }
}

fn pump_messages(state: *mut Overlay) {
    let mut message = MSG::default();
    loop {
        if unsafe { (*state).outcome } != Outcome::Active {
            return;
        }
        let received =
            unsafe { GetMessageW(&mut message, None, NO_MESSAGE_FILTER, NO_MESSAGE_FILTER) };
        if received.0 <= MESSAGE_LOOP_END {
            return;
        }
        unsafe {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

unsafe fn attach_overlay_state(window: HWND, lparam: LPARAM) {
    let creation = lparam.0 as *const CREATESTRUCTW;
    if creation.is_null() {
        return;
    }
    let state = unsafe { (*creation).lpCreateParams };
    unsafe {
        SetWindowLongPtrW(window, GWLP_USERDATA, state as isize);
    }
}

unsafe fn overlay_state<'a>(window: HWND) -> Option<&'a mut Overlay> {
    let raw = unsafe { GetWindowLongPtrW(window, GWLP_USERDATA) } as *mut Overlay;
    unsafe { raw.as_mut() }
}

unsafe extern "system" fn overlay_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_NCCREATE {
        unsafe { attach_overlay_state(window, lparam) };
        return unsafe { DefWindowProcW(window, message, wparam, lparam) };
    }
    let Some(state) = (unsafe { overlay_state(window) }) else {
        return unsafe { DefWindowProcW(window, message, wparam, lparam) };
    };
    match message {
        WM_ERASEBKGND => LRESULT(ERASE_HANDLED),
        WM_PAINT => {
            unsafe { paint_overlay(window, state) };
            LRESULT(MESSAGE_HANDLED)
        }
        WM_LBUTTONDOWN => {
            let previous = state.selection();
            state.begin(pointer_position(lparam));
            request_redraw(window, geom::dirty_area(previous, state.selection(), FRAME_THICKNESS_PX));
            LRESULT(MESSAGE_HANDLED)
        }
        WM_MOUSEMOVE => {
            if state.dragging {
                let previous = state.selection();
                state.drag(pointer_position(lparam));
                request_redraw(window, geom::dirty_area(previous, state.selection(), FRAME_THICKNESS_PX));
            }
            LRESULT(MESSAGE_HANDLED)
        }
        WM_LBUTTONUP => {
            state.finish(pointer_position(lparam));
            LRESULT(MESSAGE_HANDLED)
        }
        WM_RBUTTONDOWN => {
            state.cancel();
            LRESULT(MESSAGE_HANDLED)
        }
        WM_KEYDOWN if wparam.0 == usize::from(VK_ESCAPE.0) => {
            state.cancel();
            LRESULT(MESSAGE_HANDLED)
        }
        _ => unsafe { DefWindowProcW(window, message, wparam, lparam) },
    }
}

unsafe fn paint_overlay(window: HWND, state: &Overlay) {
    let mut paint = PAINTSTRUCT::default();
    let target = unsafe { BeginPaint(window, &mut paint) };
    if !target.is_invalid() {
        unsafe {
            compose_overlay(state, paint.rcPaint);
            blit(target, state.back, as_geom_rect(paint.rcPaint));
        }
    }
    unsafe {
        let _ = EndPaint(window, &paint);
    }
}

unsafe fn compose_overlay(state: &Overlay, clip: RECT) {
    let Some(clip) = geom::non_empty(as_geom_rect(clip)) else {
        return;
    };
    unsafe { blit(state.back, state.dimmed, clip) };
    let Some(selection) = state.selection() else {
        return;
    };
    if let Some(visible) = geom::intersection(selection, clip) {
        unsafe { blit(state.back, state.original, visible) };
    }
    unsafe { draw_selection_frame(state.back, selection) };
}

unsafe fn blit(target: HDC, source: HDC, area: GeomRect) {
    unsafe {
        let _ = BitBlt(
            target,
            area.left,
            area.top,
            area.right - area.left,
            area.bottom - area.top,
            Some(source),
            area.left,
            area.top,
            SRCCOPY,
        );
    }
}

unsafe fn draw_selection_frame(target: HDC, selection: GeomRect) {
    let brush = unsafe { CreateSolidBrush(FRAME_COLOR) };
    if brush.is_invalid() {
        return;
    }
    for ring in FIRST_FRAME_RING..=FRAME_THICKNESS_PX {
        let outline = as_win_rect(geom::inflated(selection, ring));
        unsafe { FrameRect(target, &outline, brush) };
    }
    unsafe {
        let _ = DeleteObject(brush.into());
    }
}

fn crop_to_png(source: &Canvas, area: GeomRect) -> Result<Vec<u8>, String> {
    let width = area.width() as usize;
    let height = area.height() as usize;
    let stride = source.width as usize * SOURCE_CHANNELS;
    let pixels = source.pixels();
    let mut rgb = Vec::with_capacity(width * height * OUTPUT_CHANNELS);
    for row in 0..height {
        let line = &pixels[geom::row_byte_range(area, row, stride, SOURCE_CHANNELS)];
        let (samples, _) = line.as_chunks::<SOURCE_CHANNELS>();
        for sample in samples {
            rgb.push(sample[CHANNEL_RED]);
            rgb.push(sample[CHANNEL_GREEN]);
            rgb.push(sample[CHANNEL_BLUE]);
        }
    }
    encode_png(&rgb, width, height)
}

fn encode_png(rgb: &[u8], width: usize, height: usize) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    let mut encoder = Encoder::new(&mut png, width as u32, height as u32);
    encoder.set_color(ColorType::Rgb);
    encoder.set_depth(BitDepth::Eight);
    // Снимок живёт секунды и уходит в модель; сжимать его дефолтным уровнем на
    // главном потоке — платить сотни миллисекунд за байты, которые никто не хранит.
    encoder.set_compression(Compression::Fast);
    let mut writer = encoder
        .write_header()
        .map_err(|_| PNG_ENCODE_FAILED.to_string())?;
    writer
        .write_image_data(rgb)
        .map_err(|_| PNG_ENCODE_FAILED.to_string())?;
    writer.finish().map_err(|_| PNG_ENCODE_FAILED.to_string())?;
    Ok(png)
}
