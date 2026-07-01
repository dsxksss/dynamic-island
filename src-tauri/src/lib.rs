//! Desktop Dynamic Island — Tauri backend entry point.

mod identity;
mod notification_listener;
mod notifications;
mod window_setup;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewWindow,
};

use notifications::{ListenerStatus, Notification};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance: the second launch is silently blocked (Windows mutex).
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            // Second instance attempted — could focus the window here; we just
            // ignore it.
        }));
    }

    builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            let window: WebviewWindow = app
                .get_webview_window("island")
                .expect("island window is declared in tauri.conf.json");

            window_setup::apply_transparency_workaround(&window);
            window_setup::center_top(&window);
            // Never steal focus from other apps.
            let _ = window.set_focusable(false);

            // Cursor watcher: emits top-hover events so the hidden/click-through
            // island can be summoned by hovering the screen's top edge, and
            // reports whether the cursor is over the pill (for click-through).
            window_setup::start_cursor_watcher(app.handle().clone());

            // --- system tray -------------------------------------------------
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let toggle_item = MenuItem::with_id(
                app,
                "toggle",
                "隐藏灵动岛",
                true,
                None::<&str>,
            )?;
            let autostart_on = app
                .state::<tauri_plugin_autostart::AutoLaunchManager>()
                .is_enabled()
                .unwrap_or(false);
            let autostart_item = MenuItem::with_id(
                app,
                "autostart",
                if autostart_on { "✓ 开机自启" } else { "开机自启" },
                true,
                None::<&str>,
            )?;
            let menu = Menu::with_items(app, &[&toggle_item, &autostart_item, &quit_item])?;

            // Clone the autostart menu item so we can update its text from the
            // toggle handler (MenuItem is cheaply cloneable, backed by an Arc).
            let autostart_item_handle = autostart_item.clone();

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Dynamic Island")
                .menu(&menu)
                .on_menu_event(move |app_handle, event| match event.id.as_ref() {
                    "quit" => {
                        app_handle.exit(0);
                    }
                    "toggle" => {
                        if let Some(w) = app_handle.get_webview_window("island") {
                            if w.is_visible().unwrap_or(true) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                            }
                        }
                    }
                    "autostart" => {
                        let mgr = app_handle
                            .state::<tauri_plugin_autostart::AutoLaunchManager>();
                        let now_on = if mgr.is_enabled().unwrap_or(false) {
                            let _ = mgr.disable();
                            false
                        } else {
                            let _ = mgr.enable();
                            true
                        };
                        let _ = autostart_item_handle
                            .set_text(if now_on { "✓ 开机自启" } else { "开机自启" });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click toggles focus on the island.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        if let Some(w) = tray.app_handle().get_webview_window("island") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            poll_notifications,
            get_listener_status,
            platform_info,
            dismiss_notification,
            set_pill_rect_cmd,
            recenter_island,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Poll for new system toast notifications. Called by the frontend every ~2.5s.
/// Returns only notifications not previously returned (deduped by Windows id).
#[tauri::command]
async fn poll_notifications() -> Vec<Notification> {
    // Run the (potentially blocking) WinRT poll on a tokio blocking thread so we
    // never stall the async runtime.
    tauri::async_runtime::spawn_blocking(|| notification_listener::poll())
        .await
        .unwrap_or_default()
}

/// Pull-style listener status. On a packaged MSIX build this is "available" once
/// the user grants notification access in Settings.
#[tauri::command]
fn get_listener_status() -> ListenerStatus {
    let has_identity = identity::has_package_identity();
    ListenerStatus {
        available: has_identity && cfg!(windows),
        reason: if has_identity {
            None
        } else {
            Some("no-identity".into())
        },
        message: if has_identity {
            "已打包。请在 Windows 设置 → 通知 中允许本应用读取通知。".into()
        } else {
            "当前以解包模式运行，无法捕获真实通知（用演示数据）。".into()
        },
    }
}

/// Tell the backend where the pill is on screen (for the cursor watcher).
#[tauri::command]
fn set_pill_rect_cmd(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) {
    if let Some(window) = app.get_webview_window("island") {
        window_setup::set_pill_rect(&window, x, y, width, height);
    }
}

/// Re-center the island (after monitor changes).
#[tauri::command]
fn recenter_island(app: tauri::AppHandle) {
    window_setup::recenter(&app);
}

/// Basic platform/identity info.
#[tauri::command]
fn platform_info() -> serde_json::Value {
    serde_json::json!({
        "platform": std::env::consts::OS,
        "hasPackageIdentity": identity::has_package_identity(),
    })
}

/// Acknowledge/dismiss a notification (informational for now).
#[tauri::command]
fn dismiss_notification(id: String) -> String {
    id
}
