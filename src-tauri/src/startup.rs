//! Portable EXE handover, compatible with the existing single-instance plugin.
#[cfg(windows)]
mod windows_impl;
#[cfg(windows)]
pub use windows_impl::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version(pub [u16; 4]);

#[derive(Debug, PartialEq, Eq)]
enum ExistingInstanceAction { Forward, KeepRunning, AskToSwitch }

fn existing_instance_action(same_path: bool, running: Option<Version>, current: Option<Version>, automatic: bool) -> ExistingInstanceAction {
    if same_path { return ExistingInstanceAction::Forward; }
    if automatic || matches!((running, current), (Some(old), Some(new)) if old > new) {
        ExistingInstanceAction::KeepRunning
    } else {
        ExistingInstanceAction::AskToSwitch
    }
}

fn may_update_startup(registered: Option<Version>, current: Option<Version>) -> bool {
    match (registered, current) {
        (Some(old), Some(new)) => new >= old,
        (Some(_), None) => false,
        _ => true,
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.0[0], self.0[1], self.0[2])
    }
}

/// Handle both our new quoted command and the old plugin's unquoted path.
fn command_exe(command: &str) -> Option<&str> {
    let command = command.trim();
    if let Some(quoted) = command.strip_prefix('"') {
        return quoted.split_once('"').map(|(path, _)| path);
    }
    let lower = command.to_ascii_lowercase();
    lower.match_indices(".exe").find_map(|(index, _)| {
        let end = index + 4;
        (command.len() == end || command[end..].starts_with(char::is_whitespace))
            .then_some(&command[..end])
    })
}

fn startup_command(path: &std::path::Path) -> String {
    format!("\"{}\" --autostart", path.display())
}

#[cfg(not(windows))]
pub fn prepare() -> Option<()> { Some(()) }

#[cfg(not(windows))]
pub fn refresh_autostart(_name: &str) -> Result<(), String> { Ok(()) }

#[cfg(not(windows))]
pub fn report(message: &str) { eprintln!("{message}"); }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handles_legacy_paths_and_quoted_paths() {
        assert_eq!(command_exe(r#""C:\My Apps\灵动岛.exe" --autostart"#), Some(r"C:\My Apps\灵动岛.exe"));
        assert_eq!(command_exe(r"C:\My Apps\island.EXE --autostart"), Some(r"C:\My Apps\island.EXE"));
        assert_eq!(command_exe(r"C:\foo.exe-folder\island.exe --autostart"), Some(r"C:\foo.exe-folder\island.exe"));
        assert_eq!(command_exe("not an executable"), None);
    }
    #[test]
    fn startup_paths_are_always_quoted() {
        assert_eq!(startup_command(std::path::Path::new(r"C:\My Apps\新版本.exe")), r#""C:\My Apps\新版本.exe" --autostart"#);
    }
    #[test]
    fn compares_versions_numerically_including_patch_and_revision() {
        assert!(Version([1, 10, 0, 0]) > Version([1, 3, 2, 0]));
        assert!(Version([1, 3, 2, 0]) > Version([1, 3, 1, 0]));
        assert!(Version([1, 3, 2, 1]) > Version([1, 3, 2, 0]));
        assert_eq!(Version([1, 3, 2, 0]), Version([1, 3, 2, 0]));
    }
    #[test]
    fn launching_another_copy_requires_confirmation_except_for_autostart() {
        let old = Some(Version([1, 3, 1, 0]));
        let new = Some(Version([1, 3, 2, 0]));
        assert_eq!(existing_instance_action(true, old, old, false), ExistingInstanceAction::Forward);
        assert_eq!(existing_instance_action(false, old, new, false), ExistingInstanceAction::AskToSwitch);
        assert_eq!(existing_instance_action(false, new, old, false), ExistingInstanceAction::KeepRunning);
        assert_eq!(existing_instance_action(false, old, new, true), ExistingInstanceAction::KeepRunning);
        assert_eq!(existing_instance_action(false, None, new, false), ExistingInstanceAction::AskToSwitch);
        assert_eq!(existing_instance_action(false, new, new, false), ExistingInstanceAction::AskToSwitch);
    }
    #[test]
    fn never_downgrades_a_known_newer_startup_target() {
        let old = Some(Version([1, 3, 1, 0]));
        let new = Some(Version([1, 3, 2, 0]));
        assert!(may_update_startup(old, new));
        assert!(may_update_startup(new, new));
        assert!(may_update_startup(None, new));
        assert!(!may_update_startup(new, old));
        assert!(!may_update_startup(new, None));
    }
}
