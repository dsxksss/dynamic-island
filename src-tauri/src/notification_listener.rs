//! Windows notification capture — poll-based, mirroring the NetSpeed-Dynamic
//! reference project exactly (windows 0.58 with .get()).
//!
//! Frontend calls `poll_notifications` every ~2.5s. Each call:
//!   1. fire-and-forget RequestAccessAsync (primes consent via package identity)
//!   2. GetNotificationsAsync(Toast).get()  (blocking, on a tokio worker thread)
//!   3. parse toasts via Notification().Visual().GetBinding("ToastGeneric")
//!   4. dedupe by id (AtomicU32 of max seen id)

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};

use crate::notifications::{Notification, NotificationKind};

/// Highest notification id we've returned. New ones have higher ids.
static MAX_ID: AtomicU32 = AtomicU32::new(0);
/// Whether we've done our first scan (so we skip the initial backlog).
static INITIALIZED: AtomicU32 = AtomicU32::new(0);

/// Cache app icons by app-name so we only grab the (slow) stream once per app.
static ICON_CACHE: once_cell::sync::Lazy<parking_lot::Mutex<HashMap<String, String>>> =
    once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(HashMap::new()));

#[cfg(windows)]
pub fn poll() -> Vec<Notification> {
    use windows::UI::Notifications::Management::UserNotificationListener;
    use windows::UI::Notifications::NotificationKinds;

    let listener = match UserNotificationListener::Current() {
        Ok(l) => l,
        Err(_) => return vec![],
    };

    // fire-and-forget; consent is gated by package identity, not by awaiting.
    let _ = listener.RequestAccessAsync();

    let notifications = match listener.GetNotificationsAsync(NotificationKinds::Toast) {
        Ok(op) => match op.get() {
            Ok(ns) => ns,
            Err(_) => return vec![],
        },
        Err(_) => return vec![],
    };

    let count = match notifications.Size() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut max_seen = MAX_ID.load(Ordering::Relaxed);
    let first_scan = INITIALIZED.swap(1, Ordering::Relaxed) == 0;

    // On the first scan, find the current max id and skip everything (so we
    // don't flood the island with the existing backlog at startup).
    if first_scan {
        for i in 0..count {
            if let Ok(n) = notifications.GetAt(i) {
                if let Ok(id) = n.Id() {
                    if id > max_seen {
                        max_seen = id;
                    }
                }
            }
        }
        MAX_ID.store(max_seen, Ordering::Relaxed);
        return vec![];
    }

    let mut out = vec![];
    for i in 0..count {
        let n = match notifications.GetAt(i) {
            Ok(n) => n,
            Err(_) => continue,
        };
        let id = match n.Id() {
            Ok(id) => id,
            Err(_) => continue,
        };
        if id <= max_seen {
            continue;
        }
        if id > max_seen {
            max_seen = id;
        }
        if let Some(parsed) = parse_notification(&n) {
            out.push(parsed);
        }
    }

    MAX_ID.store(max_seen, Ordering::Relaxed);
    out
}

#[cfg(not(windows))]
pub fn poll() -> Vec<Notification> {
    vec![]
}

#[cfg(windows)]
fn parse_notification(n: &windows::UI::Notifications::UserNotification) -> Option<Notification> {
    let notif = n.Notification().ok()?;
    let visual = notif.Visual().ok()?;

    // Collect text from ALL bindings, not just "ToastGeneric". Many toasts use
    // legacy templates (ToastText01/02 etc.) where the entire body is in text[0].
    // We try ToastGeneric first (modern, has title+body split), then fall back
    // to enumerating every binding.
    let mut texts: Vec<String> = Vec::new();

    // 1. Try ToastGeneric first (the common modern path).
    if let Ok(binding) = visual.GetBinding(&windows::core::HSTRING::from("ToastGeneric")) {
        collect_binding_texts(&binding, &mut texts);
    }

    // 2. Fallback: if ToastGeneric had no text, enumerate all bindings.
    if texts.is_empty() {
        if let Ok(bindings) = visual.Bindings() {
            let cnt = bindings.Size().unwrap_or(0);
            for i in 0..cnt {
                if let Ok(b) = bindings.GetAt(i) {
                    collect_binding_texts(&b, &mut texts);
                    if !texts.is_empty() {
                        break;
                    }
                }
            }
        }
    }

    // Split into title/body. If only one text element, it's the whole message —
    // put it in body (and use app name as title) so the detail view shows it.
    let (title, body) = if texts.len() <= 1 {
        (String::new(), texts.into_iter().next().unwrap_or_default())
    } else {
        (texts[0].clone(), texts[1..].join("\n"))
    };

    let app_info = n.AppInfo().ok();
    let display_info = app_info.as_ref().and_then(|ai| ai.DisplayInfo().ok());
    let app_name = display_info
        .as_ref()
        .and_then(|di| di.DisplayName().ok())
        .map(|h| h.to_string())
        .unwrap_or_else(|| "应用".to_string());

    // Icon: use cache keyed by app name so we only do the slow stream read once.
    // IMPORTANT: don't cache failures (empty string) — retry on subsequent polls.
    let icon = {
        let cache = ICON_CACHE.lock();
        cache.get(&app_name).cloned().filter(|s| !s.is_empty())
    };
    let icon = match icon {
        Some(cached) => cached,
        None => {
            let grabbed = display_info
                .as_ref()
                .and_then(|di| grab_icon_b64(di))
                .unwrap_or_default();
            // Only cache successful grabs; let failures retry next time.
            if !grabbed.is_empty() {
                ICON_CACHE.lock().insert(app_name.clone(), grabbed.clone());
            }
            grabbed
        }
    };

    Some(Notification {
        id: n.Id().ok()?.to_string(),
        app_name,
        icon,
        title,
        body,
        timestamp: creation_time_ms(n),
        kind: NotificationKind::Generic,
    })
}

#[cfg(windows)]
fn collect_binding_texts(
    binding: &windows::UI::Notifications::NotificationBinding,
    out: &mut Vec<String>,
) {
    if let Ok(te) = binding.GetTextElements() {
        let cnt = te.Size().unwrap_or(0);
        for i in 0..cnt {
            if let Ok(el) = te.GetAt(i) {
                if let Ok(t) = el.Text() {
                    let t = t.to_string();
                    if !t.is_empty() {
                        out.push(t);
                    }
                }
            }
        }
    }
}

/// Grab the app's logo from its DisplayInfo, read the stream into bytes, and
/// return as a `data:image/<type>;base64,...` URL. Returns None if unavailable.
#[cfg(windows)]
fn grab_icon_b64(
    di: &windows::ApplicationModel::AppDisplayInfo,
) -> Option<String> {
    use windows::Foundation::Size;
    use windows::Storage::Streams::DataReader;

    // Request a 48x48 logo; the system picks the best matching asset.
    let logo_ref = di.GetLogo(Size { Width: 48.0, Height: 48.0 }).ok()?;
    let stream = logo_ref.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 || size > 512 * 1024 {
        let _ = stream.Close();
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    let loaded = reader.LoadAsync(size).ok()?.get().ok().unwrap_or(0);
    if loaded == 0 {
        let _ = reader.Close();
        let _ = stream.Close();
        return None;
    }
    let mut buf = vec![0u8; loaded as usize];
    if reader.ReadBytes(&mut buf).is_err() {
        let _ = reader.Close();
        let _ = stream.Close();
        return None;
    }
    let _ = reader.Close();
    let _ = stream.Close();

    // Detect the image type from magic bytes (logos may be PNG, JPEG, or GIF).
    let mime = sniff_mime(&buf);
    let b64 = base64_encode(&buf);
    Some(format!("data:{mime};base64,{b64}"))
}

/// Sniff the image MIME type from magic bytes.
#[cfg(windows)]
fn sniff_mime(buf: &[u8]) -> &'static str {
    if buf.len() >= 8 && buf[..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        "image/png"
    } else if buf.len() >= 3 && &buf[..3] == [0xFF, 0xD8, 0xFF] {
        "image/jpeg"
    } else if buf.len() >= 6 && (&buf[..6] == b"GIF87a" || &buf[..6] == b"GIF89a") {
        "image/gif"
    } else {
        // default to png (most WinRT logos are png)
        "image/png"
    }
}

/// Minimal base64 encoder (no external dep).
#[cfg(windows)]
fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    let mut i = 0;
    while i + 2 < input.len() {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8) | input[i + 2] as u32;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(TABLE[((n >> 6) & 63) as usize] as char);
        out.push(TABLE[(n & 63) as usize] as char);
        i += 3;
    }
    let rem = input.len() - i;
    if rem == 1 {
        let n = (input[i] as u32) << 16;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rem == 2 {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8);
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(TABLE[((n >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
}

#[cfg(windows)]
fn creation_time_ms(n: &windows::UI::Notifications::UserNotification) -> i64 {
    let dt = n.CreationTime().unwrap_or_default();
    // DateTime.UniversalTime = 100ns ticks since 1601; convert to unix ms.
    let ticks = dt.UniversalTime;
    let unix_100ns = ticks - 116_444_736_000_000_000;
    unix_100ns / 10_000
}
