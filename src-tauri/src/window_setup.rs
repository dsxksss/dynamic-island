//! Window positioning and Windows-specific transparent-window workarounds.

use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, LogicalPosition, Manager, PhysicalSize, WebviewWindow};

/// Position the island window flush at the very top-center of its current
/// monitor (y = 0) and re-assert always-on-top. Called at startup and on
/// recenter. No top margin: the island hangs from the screen's top edge so the
/// "notch" peek is flush against the bezel.
pub fn center_top(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let size = monitor.size();
    let scale = monitor.scale_factor();

    let win_size = window.outer_size().unwrap_or(PhysicalSize {
        width: 480,
        height: 240,
    });
    let win_w_logical = win_size.width as f64 / scale;
    let mon_w_logical = size.width as f64 / scale;

    let x = (mon_w_logical - win_w_logical) / 2.0;
    let y = 0.0; // flush to the very top — no margin
    let _ = window.set_position(LogicalPosition::new(x, y));

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

/// The event name emitted by the cursor watcher describing where the pointer is
/// relative to the island. `hovering` = inside the top-edge summon zone;
/// `overPill` = directly over the visible pill footprint.
pub const EVT_TOP_HOVER: &str = "island://top-hover";

/// The current pill footprint (logical px, screen-relative to the window's
/// top-left). Set by the frontend so the cursor watcher can hit-test it. Stored
/// in physical px internally.
static PILL_RECT: parking_lot::Mutex<Option<PillRect>> = parking_lot::const_mutex(None);

#[derive(Clone, Copy)]
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
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    // Convert logical-relative to physical screen-absolute.
    let Ok(win_pos) = window.outer_position() else {
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
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    // Summon zone: a thin strip at the very top of the screen.
    const STRIP_HEIGHT_PX: i32 = 6;
    const POLL_INTERVAL: Duration = Duration::from_millis(50);

    let mut hovering = false;
    let mut over_pill = false;

    loop {
        thread::sleep(POLL_INTERVAL);

        let Some(window) = app.get_webview_window("island") else {
            continue;
        };

        let mut pt = POINT { x: 0, y: 0 };
        if !unsafe { GetCursorPos(&mut pt) }.is_ok() {
            continue;
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
        let now_over_pill = PILL_RECT
            .lock()
            .map(|r| pt.x >= r.x0 && pt.x <= r.x1 && pt.y >= r.y0 && pt.y <= r.y1)
            .unwrap_or(false);
        // silence unused on platforms without the lock helper
        let _ = &scale;

        if now_hovering != hovering || now_over_pill != over_pill {
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

