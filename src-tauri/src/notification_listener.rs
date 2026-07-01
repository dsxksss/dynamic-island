//! Windows notification capture — poll-based, mirroring the NetSpeed-Dynamic
//! reference project exactly (windows 0.58 with .get()).
//!
//! Frontend calls `poll_notifications` every ~2.5s. Each call:
//!   1. fire-and-forget RequestAccessAsync (primes consent via package identity)
//!   2. GetNotificationsAsync(Toast).get()  (blocking, on a tokio worker thread)
//!   3. parse toasts via Notification().Visual().GetBinding("ToastGeneric")
//!   4. dedupe by id (AtomicU32 of max seen id)

use std::sync::atomic::{AtomicU32, Ordering};

use crate::notifications::{Notification, NotificationKind};

/// Highest notification id we've returned. New ones have higher ids.
static MAX_ID: AtomicU32 = AtomicU32::new(0);
/// Whether we've done our first scan (so we skip the initial backlog).
static INITIALIZED: AtomicU32 = AtomicU32::new(0);

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
    // Parse via the toast Visual → ToastGeneric binding → text elements, the
    // same path the reference project uses.
    let notif = n.Notification().ok()?;
    let visual = notif.Visual().ok()?;
    let binding = visual.GetBinding(&windows::core::HSTRING::from("ToastGeneric")).ok()?;

    let mut texts: Vec<String> = Vec::new();
    if let Ok(te) = binding.GetTextElements() {
        let cnt = te.Size().unwrap_or(0);
        for i in 0..cnt {
            if let Ok(el) = te.GetAt(i) {
                if let Ok(t) = el.Text() {
                    let t = t.to_string();
                    if !t.is_empty() {
                        texts.push(t);
                    }
                }
            }
        }
    }

    let title = texts.first().cloned().unwrap_or_default();
    let body = if texts.len() > 1 {
        texts[1..].join(" ")
    } else {
        String::new()
    };

    let app_name = n
        .AppInfo()
        .ok()
        .and_then(|ai| ai.DisplayInfo().ok())
        .and_then(|di| di.DisplayName().ok())
        .map(|h| h.to_string())
        .unwrap_or_else(|| "应用".to_string());

    Some(Notification {
        id: n.Id().ok()?.to_string(),
        app_name,
        title,
        body,
        timestamp: creation_time_ms(n),
        kind: NotificationKind::Generic,
    })
}

#[cfg(windows)]
fn creation_time_ms(n: &windows::UI::Notifications::UserNotification) -> i64 {
    let dt = n.CreationTime().unwrap_or_default();
    // DateTime.UniversalTime = 100ns ticks since 1601; convert to unix ms.
    let ticks = dt.UniversalTime;
    let unix_100ns = ticks - 116_444_736_000_000_000;
    unix_100ns / 10_000
}
