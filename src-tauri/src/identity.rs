//! Detect whether the process has Windows package identity (MSIX).
//!
//! `UserNotificationListener` only works when the process is packaged — a plain
//! unpackaged exe (e.g. `cargo tauri dev`) returns "no package identity" and the
//! listener must fall back to demo mode. We probe once at startup.

#[cfg(windows)]
pub fn has_package_identity() -> bool {
    use windows::ApplicationModel::Package;
    // Package::Current() returns Err(0x80073D54 APPMODEL_ERROR_NO_PACKAGE) when
    // the process has no package identity.
    Package::Current().is_ok()
}

#[cfg(not(windows))]
pub fn has_package_identity() -> bool {
    false
}
