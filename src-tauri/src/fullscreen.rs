//! Observe the foreground app without activating or changing any windows.
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::Emitter;

static FULLSCREEN: AtomicBool = AtomicBool::new(false);

pub fn current() -> bool {
    FULLSCREEN.load(Ordering::Relaxed)
}

fn fills_monitor(window: (i32, i32, i32, i32), monitor: (i32, i32, i32, i32)) -> bool {
    [window.0 - monitor.0, window.1 - monitor.1, window.2 - monitor.2, window.3 - monitor.3]
        .iter().all(|delta| delta.abs() <= 2)
}

#[cfg(windows)]
fn sample() -> Option<bool> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId,
        GetDesktopWindow, GetShellWindow, GetWindowLongW, IsIconic, IsWindowVisible,
        GWL_STYLE, WS_CAPTION,
    };
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() { return None; }
        let mut process_id = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        // Editing our settings should not switch the mode and replace the
        // settings underneath the user's pointer.
        if process_id == std::process::id() { return None; }
        if hwnd == GetDesktopWindow() || hwnd == GetShellWindow()
            || IsIconic(hwnd).as_bool() || !IsWindowVisible(hwnd).as_bool() {
            return Some(false);
        }
        // A regular maximized window is not a full-screen application.
        if GetWindowLongW(hwnd, GWL_STYLE) as u32 & WS_CAPTION.0 != 0 { return Some(false); }
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() { return None; }
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() { return None; }
        let bounds = info.rcMonitor;
        Some(fills_monitor((rect.left, rect.top, rect.right, rect.bottom),
            (bounds.left, bounds.top, bounds.right, bounds.bottom)))
    }
}

#[cfg(not(windows))]
fn sample() -> Option<bool> { Some(false) }

pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut candidate = current();
        let mut since = Instant::now();
        loop {
            if let Some(value) = sample() {
                if value != candidate {
                    candidate = value;
                    since = Instant::now();
                }
                if value != current() && since.elapsed() >= Duration::from_millis(1500) {
                    FULLSCREEN.store(value, Ordering::Relaxed);
                    let _ = app.emit("island://fullscreen", value);
                }
            } else {
                // An unknown/self foreground must not complete a pending change.
                since = Instant::now();
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fullscreen_bounds_support_secondary_monitors_and_small_rounding() {
        assert!(fills_monitor((-1920, 0, 0, 1080), (-1920, 0, 0, 1080)));
        assert!(fills_monitor((-1921, -1, 1, 1081), (-1920, 0, 0, 1080)));
        assert!(!fills_monitor((0, 0, 1920, 1040), (0, 0, 1920, 1080)));
        assert!(!fills_monitor((100, 100, 1200, 800), (0, 0, 1920, 1080)));
    }
}
