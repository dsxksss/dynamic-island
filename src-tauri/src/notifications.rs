//! Shared notification types (serialized to the frontend over IPC).

use serde::{Deserialize, Serialize};

/// A single captured notification, pushed to the frontend via the
/// `notification` event.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    /// Stable id from the Windows notification system (or synthetic for demo).
    pub id: String,
    /// Display name of the source app, e.g. "微信", "Outlook".
    pub app_name: String,
    /// Optional first line / title.
    pub title: String,
    /// Optional body / second line.
    pub body: String,
    /// Unix epoch milliseconds.
    pub timestamp: i64,
    /// Coarse category driving the island's visual variant.
    pub kind: NotificationKind,
}

/// The kind of notification — the island uses this to pick a layout variant
/// (e.g. a music widget for "music").
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NotificationKind {
    /// Default: title + body text.
    Generic,
    /// Now-playing media.
    Music,
    /// Timer / alarm countdown.
    Timer,
}

impl Default for NotificationKind {
    fn default() -> Self {
        Self::Generic
    }
}

/// Overall availability of the Windows notification listener.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenerStatus {
    /// Is real capture available right now?
    pub available: bool,
    /// Machine-readable reason when not available.
    pub reason: Option<String>,
    /// Human-readable explanation (shown in the island settings).
    pub message: String,
}
