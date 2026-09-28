//! Window positioning and Windows-specific transparent-window workarounds.

use std::thread;
use std::time::Duration;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};

const WINDOW_EDGE_MARGIN: u32 = 12;

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
pub fn restore_position(window: &WebviewWindow, saved_x: i32, saved_y: i32) {
    let Ok(size) = window.outer_size() else {
        return;
    };
    let window_width = size.width as i32;
    let window_height = size.height as i32;

    let mut bounds = None;
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
    if bounds.is_none() {
        bounds = window.current_monitor().ok().flatten().map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            (
                position.x,
                position.y,
                position.x + size.width as i32,
                position.y + size.height as i32,
            )
        });
    }
    let Some((left, top, right, bottom)) = bounds else {
        return;
    };

    let x = saved_x.clamp(left, (right - window_width).max(left));
    let y = saved_y.clamp(top, (bottom - window_height).max(top));
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
}

/// Snap a freely dragged island to whichever edge of its current monitor is
/// closest. The returned edge drives the frontend's direction-aware reveal
/// animation.
pub fn snap_to_nearest_edge(window: &WebviewWindow) -> &'static str {
    let (Ok(Some(monitor)), Ok(position), Ok(size)) = (
        window.current_monitor(),
        window.outer_position(),
        window.outer_size(),
    ) else {
        return "top";
    };

    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let window_width = size.width as i32;
    let window_height = size.height as i32;
    let monitor_right = monitor_position.x + monitor_size.width as i32;
    let monitor_bottom = monitor_position.y + monitor_size.height as i32;
    let max_x = (monitor_right - window_width).max(monitor_position.x);
    let max_y = (monitor_bottom - window_height).max(monitor_position.y);
    let clamp_x = |value: i32| value.clamp(monitor_position.x, max_x);
    let clamp_y = |value: i32| value.clamp(monitor_position.y, max_y);

    let distances = [
        ("top", (position.y - monitor_position.y).abs()),
        (
            "right",
            (monitor_right - (position.x + window_width)).abs(),
        ),
        (
            "bottom",
            (monitor_bottom - (position.y + window_height)).abs(),
        ),
        ("left", (position.x - monitor_position.x).abs()),
    ];
    let edge = distances
        .into_iter()
        .min_by_key(|(_, distance)| *distance)
        .map(|(edge, _)| edge)
        .unwrap_or("top");

    let (x, y) = match edge {
        "right" => (max_x, clamp_y(position.y)),
        "bottom" => (clamp_x(position.x), max_y),
        "left" => (monitor_position.x, clamp_y(position.y)),
        _ => (clamp_x(position.x), monitor_position.y),
    };
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
    edge
}

/// The event name emitted by the cursor watcher describing where the pointer is
/// relative to the island. `hovering` = inside the top-edge summon zone;
/// `overPill` = directly over the visible pill footprint.
pub const EVT_TOP_HOVER: &str = "island://top-hover";
pub const EVT_DRAG_RELEASED: &str = "island://drag-released";

static NATIVE_DRAGGING: AtomicBool = AtomicBool::new(false);

/// Mark whether the native window drag is active. The cursor watcher uses this
/// to detect the global mouse-button release that WebView may not receive.
pub fn set_native_dragging(active: bool) {
    NATIVE_DRAGGING.store(active, Ordering::Release);
}

/// The current pill footprint (logical px, screen-relative to the window's
/// top-left). Set by the frontend so the cursor watcher can hit-test it. Stored
/// in physical px internally.
static PILL_RECT: parking_lot::Mutex<Option<PillRect>> = parking_lot::const_mutex(None);

#[derive(Clone, Copy, PartialEq)]
struct PillRect {
    x0: i32,
    y0: i32,
    x1: i32,
    y1: i32,
}

/// Called from the frontend (via a command) to tell the backend where the pill
/// currently is on screen, so the cursor watcher can detect "cursor over pill"
/// even while the window is click-through. `x/y/w/h` are LOGICAL px relative to
/// the window's top-left corner.
pub fn set_pill_rect(window: &WebviewWindow, x: f64, y: f64, w: f64, h: f64) {
    // Use the WebView's client origin rather than the decorated outer origin.
    // After a native drag Windows can retain a few physical pixels of invisible
    // resize border; using outer_position then makes the whole pill miss the
    // cursor hit-test rectangle.
    let scale = window.scale_factor().unwrap_or(1.0);
    let Ok(win_pos) = window.inner_position().or_else(|_| window.outer_position()) else {
        return;
    };
    let px = |v: f64| (v * scale).round() as i32;
    let rect = PillRect {
        x0: win_pos.x + px(x),
        y0: win_pos.y + px(y),
        x1: win_pos.x + px(x + w),
        y1: win_pos.y + px(y + h),
    };
    *PILL_RECT.lock() = Some(rect);
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

    // Summon zone: a thin strip at the very top of the screen.
    const STRIP_HEIGHT_PX: i32 = 6;
    const POLL_INTERVAL: Duration = Duration::from_millis(50);

    let mut hovering = false;
    let mut over_pill = false;
    let mut last_rect = None;

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
        if NATIVE_DRAGGING.load(Ordering::Acquire)
            && unsafe { GetAsyncKeyState(0x01) } >= 0
        {
            NATIVE_DRAGGING.store(false, Ordering::Release);
            let _ = app.emit(EVT_DRAG_RELEASED, ());
        }

        let Ok(Some(monitor)) = window.current_monitor() else {
            continue;
        };
        let mon = monitor.position();
        let _mon_size = monitor.size();
        let scale = monitor.scale_factor();

        // Summon zone spans the full width at the very top (forgiving).
        let now_hovering =
            pt.y >= mon.y && pt.y <= mon.y + STRIP_HEIGHT_PX;

        // Pill footprint (from the frontend).
        let rect = *PILL_RECT.lock();
        let now_over_pill = rect
            .map(|r| pt.x >= r.x0 && pt.x < r.x1 && pt.y >= r.y0 && pt.y < r.y1)
            .unwrap_or(false);
        // silence unused on platforms without the lock helper
        let _ = &scale;

        if now_hovering != hovering || now_over_pill != over_pill || rect != last_rect {
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

#[cfg(not(windows))]
fn watch_loop(_app: AppHandle) {
    // No-op on non-Windows.
}

