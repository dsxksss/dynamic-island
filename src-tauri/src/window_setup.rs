//! Window positioning and Windows-specific transparent-window workarounds.

use std::thread;
use std::time::Duration;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};

const WINDOW_EDGE_MARGIN: u32 = 12;
// Keep ordinary magnetic docking tight. Releasing at the physical top edge is
// handled separately by `drag_snap_edge` below.
const SNAP_FLUSH_THRESHOLD: i32 = 16;

// The top anchor is the physical display edge. Keep work-area reservations
// for the other edges, especially the taskbar at the bottom.
fn docking_bounds(display_top: i32, work: (i32, i32, i32, i32)) -> (i32, i32, i32, i32) {
    (work.0, display_top, work.2, work.3)
}

#[cfg(windows)]
fn work_area_for_window(window: &WebviewWindow) -> Option<(i32, i32, i32, i32)> {
    use std::mem::size_of;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };

    let hwnd = window.hwnd().ok()?;
    // Tauri currently exposes the native handle through a newer `windows`
    // crate than the WinRT dependency used by this project. Re-wrap the raw
    // handle so the GDI call receives this crate's HWND type.
    let hwnd = windows::Win32::Foundation::HWND(hwnd.0);
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    if monitor.0.is_null() {
        return None;
    }
    let mut info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        return None;
    }
    Some(docking_bounds(info.rcMonitor.top, (
        info.rcWork.left,
        info.rcWork.top,
        info.rcWork.right,
        info.rcWork.bottom,
    )))
}

#[cfg(windows)]
fn work_area_for_point(x: i32, y: i32) -> Option<(i32, i32, i32, i32)> {
    use std::mem::size_of;
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };

    let monitor = unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST) };
    if monitor.0.is_null() {
        return None;
    }
    let mut info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        return None;
    }
    Some(docking_bounds(info.rcMonitor.top, (
        info.rcWork.left,
        info.rcWork.top,
        info.rcWork.right,
        info.rcWork.bottom,
    )))
}

/// Position the island window flush at the very top-center of its current
/// monitor (y = 0) and re-assert always-on-top. Called at startup and on
/// recenter. No top margin: the island hangs from the screen's top edge so the
/// "notch" peek is flush against the bezel.
pub fn center_top(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();

    let current_size = window.outer_size().unwrap_or(PhysicalSize {
        width: 480,
        height: 240,
    });
    // A remote desktop, split-screen layout, or high display scaling can make
    // the monitor narrower than the design-time 480px window. Resize first so
    // the transparent host itself never extends beyond the monitor.
    let max_width = monitor_size.width.saturating_sub(WINDOW_EDGE_MARGIN * 2);
    let max_height = monitor_size.height.saturating_sub(WINDOW_EDGE_MARGIN * 2);
    let win_size = PhysicalSize {
        width: current_size.width.min(max_width.max(1)),
        height: current_size.height.min(max_height.max(1)),
    };
    if win_size != current_size {
        let _ = window.set_size(win_size);
    }

    let x = monitor_position.x
        + ((monitor_size.width.saturating_sub(win_size.width)) / 2) as i32;
    let y = monitor_position.y;
    let _ = window.set_position(PhysicalPosition::new(x, y));

    // Force always-on-top (some configs / other always-on-top windows can shadow
    // it otherwise) and skip the taskbar.
    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
}

/// Nudge the window size by 1px and back to defeat the known Tauri-on-Windows
/// bug where a transparent + undecorated window renders with a solid/opaque
/// background until it is first resized (tauri#8632).
pub fn apply_transparency_workaround(window: &WebviewWindow) {
    let Ok(orig) = window.inner_size() else {
        return;
    };
    let nudge = PhysicalSize {
        width: orig.width + 1,
        height: orig.height + 1,
    };
    let _ = window.set_size(nudge);
    // restore after a tick (still in setup, before show in practice)
    let _ = window.set_size(orig);
}

/// Re-center after a size change so the island stays horizontally centered.
pub fn recenter(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("island") {
        center_top(&window);
    }
}

/// Restore a previously saved physical screen position while keeping the
/// entire native window inside whichever monitor contains that position.
pub fn restore_position(window: &WebviewWindow, saved_x: i32, saved_y: i32, edge: &str, docked: bool) {
    let Ok(size) = window.outer_size() else {
        return;
    };
    let window_width = size.width as i32;
    let window_height = size.height as i32;
    let scale = window.scale_factor().unwrap_or(1.0);
    let inner = window.inner_size().unwrap_or(size);
    let pill_width = (150.0_f64.min(inner.width as f64 / scale - 16.0).max(1.0) * scale).round() as i32;
    let pill_height = (38.0 * scale).round() as i32;
    let outer = window.outer_position().unwrap_or_default();
    let client = window.inner_position().unwrap_or(outer);
    let offset_x = client.x - outer.x + match edge {
        "left" => 0,
        "right" => inner.width as i32 - pill_width,
        _ => (inner.width as i32 - pill_width) / 2,
    };
    let offset_y = client.y - outer.y + match edge {
        "top" => 0,
        "bottom" => inner.height as i32 - pill_height,
        _ => (inner.height as i32 - pill_height) / 2,
    };

    let mut bounds = {
        #[cfg(windows)]
        {
            work_area_for_point(saved_x + offset_x + pill_width / 2, saved_y + offset_y + pill_height / 2)
        }
        #[cfg(not(windows))]
        {
            None
        }
    };
    if bounds.is_none() {
        if let Ok(monitors) = window.available_monitors() {
            for monitor in monitors {
                let position = monitor.position();
                let monitor_size = monitor.size();
                let right = position.x + monitor_size.width as i32;
                let bottom = position.y + monitor_size.height as i32;
                if saved_x < right
                    && saved_x + window_width > position.x
                    && saved_y < bottom
                    && saved_y + window_height > position.y
                {
                    bounds = Some((position.x, position.y, right, bottom));
                    break;
                }
            }
        }
    }
    if bounds.is_none() {
        bounds = {
            #[cfg(windows)]
            {
                work_area_for_window(window)
            }
            #[cfg(not(windows))]
            {
                window.current_monitor().ok().flatten().map(|monitor| {
                    let position = monitor.position();
                    let size = monitor.size();
                    (
                        position.x,
                        position.y,
                        position.x + size.width as i32,
                        position.y + size.height as i32,
                    )
                })
            }
        };
    }
    let Some((left, top, right, bottom)) = bounds else {
        return;
    };

    let (x, y) = if docked {
        (saved_x.clamp(left, (right - window_width).max(left)),
         if edge == "top" { top } else { saved_y.clamp(top, (bottom - window_height).max(top)) })
    } else {
        // A free pill may be fully visible even when its transparent host is
        // partly outside the monitor. Preserve that exact position on restart.
        ((saved_x + offset_x).clamp(left, (right - pill_width).max(left)) - offset_x,
         (saved_y + offset_y).clamp(top, (bottom - pill_height).max(top)) - offset_y)
    };
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
}

#[derive(serde::Deserialize)]
pub struct DragPillRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn magnetic_edge(pill: (i32, i32, i32, i32), bounds: (i32, i32, i32, i32)) -> Option<&'static str> {
    let distances = [
        ("top", (pill.1 - bounds.1).abs()),
        ("right", (bounds.2 - pill.2).abs()),
        ("bottom", (bounds.3 - pill.3).abs()),
        ("left", (pill.0 - bounds.0).abs()),
    ];
    distances.into_iter().min_by_key(|(_, distance)| *distance)
        .filter(|(_, distance)| *distance <= SNAP_FLUSH_THRESHOLD)
        .map(|(edge, _)| edge)
}

fn drag_snap_edge(
    pill: (i32, i32, i32, i32),
    bounds: (i32, i32, i32, i32),
    cursor: Option<(i32, i32)>,
    host_top: Option<i32>,
) -> Option<&'static str> {
    // A transparent 480x400 host can reach the display top before a pill
    // aligned near the host's bottom does. Treat that clamped host position as
    // an explicit top-docking gesture so the pill is laid out at y = 0.
    if host_top.is_some_and(|y| y <= bounds.1) {
        return Some("top");
    }
    // Windows can constrain the transparent host before a bottom/side-aligned
    // pill reaches the top. Releasing at the physical top is explicit docking
    // intent even if the visible pill remains farther below it.
    if let Some((x, y)) = cursor {
        if x >= bounds.0 && x < bounds.2 && y >= bounds.1 && y <= bounds.1 + 6 {
            return Some("top");
        }
    }
    magnetic_edge(pill, bounds)
}

#[cfg(test)]
mod placement_tests {
    use super::{docking_bounds, drag_snap_edge, magnetic_edge};

    #[test]
    fn top_uses_display_edge_while_bottom_keeps_taskbar_reservation() {
        assert_eq!(docking_bounds(0, (0, 40, 1920, 1040)), (0, 0, 1920, 1040));
        assert_eq!(docking_bounds(-1080, (-1920, -1040, 0, -40)), (-1920, -1080, 0, -40));
    }

    #[test]
    fn release_at_top_docks_even_when_transparent_host_limits_pill() {
        let pill = (600, 181, 750, 219);
        let bounds = (0, 0, 1920, 1040);
        assert_eq!(drag_snap_edge(pill, bounds, Some((675, 0)), Some(181)), Some("top"));
        assert_eq!(drag_snap_edge(pill, bounds, Some((675, 100)), Some(181)), None);
        assert_eq!(drag_snap_edge(pill, bounds, Some((2000, 0)), Some(181)), None);
        assert_eq!(drag_snap_edge((-900, -899, -750, -861), (-1920, -1080, 0, -40), Some((-825, -1080)), Some(-899)), Some("top"));
    }

    #[test]
    fn free_drop_does_not_snap_to_nearest_edge() {
        assert_eq!(magnetic_edge((600, 400, 750, 438), (0, 0, 1920, 1040)), None);
        assert_eq!(magnetic_edge((65, 400, 215, 438), (0, 0, 1920, 1040)), None);
    }

    #[test]
    fn only_visible_pill_within_threshold_snaps() {
        let bounds = (0, 0, 1920, 1040);
        assert_eq!(magnetic_edge((16, 400, 166, 438), bounds), Some("left"));
        assert_eq!(magnetic_edge((1760, 400, 1910, 438), bounds), Some("right"));
        assert_eq!(magnetic_edge((600, 10, 750, 48), bounds), Some("top"));
    }

    #[test]
    fn bottom_snap_uses_taskbar_work_area() {
        assert_eq!(magnetic_edge((600, 993, 750, 1031), (0, 0, 1920, 1040)), Some("bottom"));
    }

    #[test]
    fn negative_monitor_coordinates_are_supported() {
        assert_eq!(magnetic_edge((-1910, 400, -1760, 438), (-1920, 0, 0, 1040)), Some("left"));
        assert_eq!(magnetic_edge((-900, 400, -750, 438), (-1920, 0, 0, 1040)), None);
    }
}

/// Keep the released position unless the visible pill is close to an edge.
/// The transparent host window must never cause premature snapping.
pub fn snap_to_nearest_edge(window: &WebviewWindow, previous_edge: String, pill: DragPillRect) -> (String, bool) {
    let (Ok(Some(monitor)), Ok(position), Ok(size)) = (
        window.current_monitor(),
        window.outer_position(),
        window.outer_size(),
    ) else {
        return (previous_edge, false);
    };

    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let window_width = size.width as i32;
    let window_height = size.height as i32;
    let full_bounds = (
        monitor_position.x,
        monitor_position.y,
        monitor_position.x + monitor_size.width as i32,
        monitor_position.y + monitor_size.height as i32,
    );
    let (monitor_left, monitor_top, monitor_right, monitor_bottom) = {
        #[cfg(windows)]
        {
            work_area_for_window(window).unwrap_or(full_bounds)
        }
        #[cfg(not(windows))]
        {
            full_bounds
        }
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let client = window.inner_position().unwrap_or(position);
    let client_size = window.inner_size().unwrap_or(size);
    let px = |value: f64| (value * scale).round() as i32;
    let pill_x = client.x + px(pill.x);
    let pill_y = client.y + px(pill.y);
    let pill_width = px(pill.width);
    let pill_height = px(pill.height);
    let cursor = {
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::POINT;
            use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
            let mut point = POINT::default();
            unsafe { GetCursorPos(&mut point) }.ok().map(|_| (point.x, point.y))
        }
        #[cfg(not(windows))]
        { None }
    };
    let Some(edge) = drag_snap_edge(
        (pill_x, pill_y, pill_x + pill_width, pill_y + pill_height),
        (monitor_left, monitor_top, monitor_right, monitor_bottom),
        cursor,
        Some(client.y),
    ) else {
        // Do not reposition or change the layout anchor on a free drop.
        return (previous_edge, false);
    };
    let left_anchor = monitor_left;
    let top_anchor = monitor_top;
    let right_anchor = (monitor_right - window_width).max(left_anchor);
    let bottom_anchor = (monitor_bottom - window_height).max(top_anchor);
    let clamp_x = |value: i32| value.clamp(left_anchor, right_anchor);
    let clamp_y = |value: i32| value.clamp(top_anchor, bottom_anchor);
    // Compensate for the new pill alignment inside the transparent window so
    // snapping does not also jump along the edge.
    let centered_x = pill_x - (client_size.width as i32 - pill_width) / 2 - (client.x - position.x);
    let centered_y = pill_y - (client_size.height as i32 - pill_height) / 2 - (client.y - position.y);

    let (x, y) = match edge {
        "right" => (right_anchor, clamp_y(centered_y)),
        "bottom" => (clamp_x(centered_x), bottom_anchor),
        "left" => (left_anchor, clamp_y(centered_y)),
        _ => (clamp_x(centered_x), top_anchor),
    };
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
    (edge.to_string(), true)
}

/// The event name emitted by the cursor watcher describing where the pointer is
/// relative to the island. `hovering` = inside the monitor-edge summon zone;
/// `overPill` = directly over the visible pill footprint.
pub const EVT_TOP_HOVER: &str = "island://top-hover";
pub const EVT_DRAG_RELEASED: &str = "island://drag-released";

static NATIVE_DRAGGING: AtomicBool = AtomicBool::new(false);
static INTERACTION_LOCKED: AtomicBool = AtomicBool::new(false);
static INTERACTION_REFRESH: AtomicBool = AtomicBool::new(false);

pub fn set_interaction_lock(window: &WebviewWindow, active: bool) -> tauri::Result<()> {
    INTERACTION_LOCKED.store(active, Ordering::Release);
    INTERACTION_REFRESH.store(true, Ordering::Release);
    if active {
        // Make the window interactive before handing capture to native drag.
        window.set_ignore_cursor_events(false)?;
    }
    // Unlocking is resolved by the watcher using the latest native position.
    Ok(())
}

/// Mark whether the native window drag is active. The cursor watcher uses this
/// to detect the global mouse-button release that WebView may not receive.
pub fn set_native_dragging(active: bool) {
    NATIVE_DRAGGING.store(active, Ordering::Release);
    INTERACTION_REFRESH.store(true, Ordering::Release);
}

/// Store client-relative logical coordinates. Screen coordinates are computed
/// on each poll so native movement/DPI changes never leave a stale hit target.
static PILL_RECT: parking_lot::Mutex<Option<LogicalPillRect>> = parking_lot::const_mutex(None);

#[derive(Clone, Copy)]
struct LogicalPillRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl LogicalPillRect {
    fn on_screen(self, origin: PhysicalPosition<i32>, scale: f64) -> PillRect {
        let px = |value: f64| (value * scale).round() as i32;
        PillRect {
            x0: origin.x + px(self.x),
            y0: origin.y + px(self.y),
            x1: origin.x + px(self.x + self.width),
            y1: origin.y + px(self.y + self.height),
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
struct PillRect {
    x0: i32,
    y0: i32,
    x1: i32,
    y1: i32,
}

impl PillRect {
    fn contains(self, x: i32, y: i32) -> bool {
        x >= self.x0 && x < self.x1 && y >= self.y0 && y < self.y1
    }
}

fn should_ignore_cursor(over_pill: bool, locked: bool, dragging: bool) -> bool {
    !(over_pill || locked || dragging)
}

/// Called from the frontend (via a command) to tell the backend where the pill
/// currently is on screen, so the cursor watcher can detect "cursor over pill"
/// even while the window is click-through. `x/y/w/h` are LOGICAL px relative to
/// the window's top-left corner.
pub fn set_pill_rect(_window: &WebviewWindow, x: f64, y: f64, w: f64, h: f64) {
    *PILL_RECT.lock() = Some(LogicalPillRect { x, y, width: w, height: h });
    INTERACTION_REFRESH.store(true, Ordering::Release);
}

/// Start a background thread that polls the global cursor position and emits a
/// `top-hover` event whenever the pointer enters/leaves the top summon zone, and
/// an `over-pill` change whenever it enters/leaves the pill footprint.
///
/// This is needed because, when the island is hidden or click-through, the
/// window receives no mouse events — so we cannot rely on JS hover for reveal.
pub fn start_cursor_watcher(app: AppHandle) {
    thread::Builder::new()
        .name("cursor-watcher".into())
        .spawn(move || watch_loop(app))
        .ok();
}

#[cfg(windows)]
fn watch_loop(app: AppHandle) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    // Summon zone: a thin strip around every edge of the current monitor.
    const STRIP_HEIGHT_PX: i32 = 6;
    const POLL_INTERVAL: Duration = Duration::from_millis(50);

    let mut hovering = false;
    let mut over_pill = false;
    let mut last_rect = None;
    let mut last_ignore = None;
    let mut was_button_down = false;
    let mut pressed_on_pill = false;

    loop {
        thread::sleep(POLL_INTERVAL);

        let Some(window) = app.get_webview_window("island") else {
            continue;
        };

        let mut pt = POINT { x: 0, y: 0 };
        if !unsafe { GetCursorPos(&mut pt) }.is_ok() {
            continue;
        }

        // Native dragging captures the pointer outside WebView, so pointerup
        // often never reaches React. Poll the global left-button state and
        // emit an explicit release event instead.
        let button_down = unsafe { GetAsyncKeyState(0x01) } < 0;
        let released_drag = NATIVE_DRAGGING.load(Ordering::Acquire) && !button_down;
        if released_drag {
            NATIVE_DRAGGING.store(false, Ordering::Release);
            let _ = app.emit(EVT_DRAG_RELEASED, ());
        }

        let Ok(Some(monitor)) = window.current_monitor() else {
            continue;
        };
        let mon = monitor.position();
        let mon_size = monitor.size();

        // Summon zones span all four monitor edges. This lets an island that
        // was snapped left, right, or bottom be revealed without returning to
        // the top edge first.
        let full_bounds = (
            mon.x,
            mon.y,
            mon.x + mon_size.width as i32,
            mon.y + mon_size.height as i32,
        );
        let (left, top, right, bottom) = work_area_for_window(&window).unwrap_or(full_bounds);
        let now_hovering = pt.x >= left && pt.x <= left + STRIP_HEIGHT_PX
            || pt.x >= right - STRIP_HEIGHT_PX && pt.x <= right
            || pt.y >= top && pt.y <= top + STRIP_HEIGHT_PX
            || pt.y >= bottom - STRIP_HEIGHT_PX && pt.y <= bottom;

        let Ok(origin) = window.inner_position().or_else(|_| window.outer_position()) else {
            continue;
        };
        let scale = window.scale_factor().unwrap_or(1.0);
        let rect = (*PILL_RECT.lock()).map(|r| r.on_screen(origin, scale));
        let now_over_pill = rect
            .map(|r| r.contains(pt.x, pt.y))
            .unwrap_or(false);
        let released_button = was_button_down && !button_down;
        if !button_down {
            pressed_on_pill = false;
        } else if !was_button_down && now_over_pill {
            pressed_on_pill = true;
        }
        was_button_down = button_down;
        let ignore = should_ignore_cursor(
            now_over_pill,
            INTERACTION_LOCKED.load(Ordering::Acquire) || pressed_on_pill,
            NATIVE_DRAGGING.load(Ordering::Acquire),
        );
        // One owner controls WS_EX_TRANSPARENT. Reassert after native capture
        // ends even if hover is unchanged, then enable the next drag normally.
        let refresh = INTERACTION_REFRESH.swap(false, Ordering::AcqRel);
        if last_ignore != Some(ignore) || released_drag || released_button || refresh || rect != last_rect {
            if window.set_ignore_cursor_events(ignore).is_ok() {
                last_ignore = Some(ignore);
            }
        }

        if refresh || now_hovering != hovering || now_over_pill != over_pill || rect != last_rect {
            last_rect = rect;
            hovering = now_hovering;
            over_pill = now_over_pill;
            let _ = app.emit(
                EVT_TOP_HOVER,
                serde_json::json!({
                    "hovering": hovering,
                    "overPill": over_pill,
                }),
            );
        }
    }
}

#[cfg(test)]
mod hit_test_tests {
    use super::*;

    #[test]
    fn hit_target_follows_two_moves_without_frontend_move_events() {
        let logical = LogicalPillRect { x: 165.0, y: 0.0, width: 150.0, height: 38.0 };
        let first = logical.on_screen(PhysicalPosition::new(100, 100), 1.0);
        let second = logical.on_screen(PhysicalPosition::new(700, 400), 1.0);
        let third = logical.on_screen(PhysicalPosition::new(300, 600), 1.0);
        assert!(first.contains(280, 110));
        assert!(!second.contains(280, 110));
        assert!(second.contains(880, 410));
        assert!(third.contains(480, 610));
    }

    #[test]
    fn hit_target_uses_current_dpi_and_negative_monitor_origin() {
        let logical = LogicalPillRect { x: 165.0, y: 0.0, width: 150.0, height: 38.0 };
        let rect = logical.on_screen(PhysicalPosition::new(-1000, 200), 1.5);
        assert!(rect.contains(-740, 220));
        assert!(!rect.contains(-760, 220));
    }

    #[test]
    fn release_over_pill_stays_interactive_for_next_drag() {
        assert!(!should_ignore_cursor(false, false, true));
        assert!(!should_ignore_cursor(true, false, false));
        assert!(!should_ignore_cursor(true, true, true));
        assert!(should_ignore_cursor(false, false, false));
    }

    #[test]
    fn hidden_pill_and_closed_settings_do_not_keep_large_hit_target() {
        let hidden = LogicalPillRect { x: 165.0, y: 0.0, width: 0.0, height: 0.0 };
        assert!(!hidden.on_screen(PhysicalPosition::new(0, 0), 1.0).contains(165, 0));
        let idle = LogicalPillRect { x: 165.0, y: 0.0, width: 150.0, height: 38.0 };
        assert!(!idle.on_screen(PhysicalPosition::new(0, 0), 1.0).contains(250, 200));
    }
}

#[cfg(not(windows))]
fn watch_loop(_app: AppHandle) {
    // No-op on non-Windows.
}

