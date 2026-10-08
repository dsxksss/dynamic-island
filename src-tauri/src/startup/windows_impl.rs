use super::{command_exe, existing_instance_action, may_update_startup, startup_command, ExistingInstanceAction, Version};
use std::path::{Path, PathBuf};
use windows::{core::{w, HSTRING, PWSTR}, Win32::{
    Foundation::{CloseHandle, BOOL, HANDLE, HWND, LPARAM, WPARAM, WAIT_ABANDONED, WAIT_OBJECT_0},
    Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO},
    System::Threading::{CreateMutexW, OpenProcess, QueryFullProcessImageNameW, ReleaseMutex, WaitForSingleObject,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE},
    UI::WindowsAndMessaging::{EnumWindows, FindWindowW, GetWindowTextW, GetWindowThreadProcessId,
        MessageBoxW, PostMessageW, IDCANCEL, IDYES, MB_DEFBUTTON2, MB_ICONINFORMATION,
        MB_ICONWARNING, MB_OK, MB_RETRYCANCEL, MB_YESNO, WM_CLOSE},
}};
use winreg::{enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE}, RegKey};

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

struct Process(HANDLE);
impl Drop for Process {
    fn drop(&mut self) { unsafe { let _ = CloseHandle(self.0); } }
}

// Store the raw value like the single-instance plugin. The setup callback runs
// on the same main thread that owns this mutex and releases it after setup.
pub struct LaunchGuard(isize);
impl Drop for LaunchGuard {
    fn drop(&mut self) {
        unsafe {
            let handle = HANDLE(self.0 as _);
            let _ = ReleaseMutex(handle);
            let _ = CloseHandle(handle);
        }
    }
}

pub fn report(message: &str) {
    unsafe { MessageBoxW(None, &HSTRING::from(message), w!("Dynamic Island"), MB_OK | MB_ICONINFORMATION); }
}

fn file_version(path: &Path) -> Option<Version> {
    let filename = HSTRING::from(path.as_os_str());
    unsafe {
        let size = GetFileVersionInfoSizeW(&filename, None);
        if size == 0 { return None; }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(&filename, 0, size, data.as_mut_ptr().cast()).ok()?;
        let mut info = std::ptr::null_mut();
        let mut len = 0;
        if !VerQueryValueW(data.as_ptr().cast(), w!("\\"), &mut info, &mut len).as_bool()
            || info.is_null() || len < std::mem::size_of::<VS_FIXEDFILEINFO>() as u32 { return None; }
        let info = std::ptr::read_unaligned(info.cast::<VS_FIXEDFILEINFO>());
        if info.dwSignature != 0xFEEF04BD { return None; }
        Some(Version([(info.dwFileVersionMS >> 16) as u16, info.dwFileVersionMS as u16,
            (info.dwFileVersionLS >> 16) as u16, info.dwFileVersionLS as u16]))
    }
}

fn process_path(process: HANDLE) -> Option<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    let mut buffer = vec![0u16; 32768];
    let mut len = buffer.len() as u32;
    unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut len).ok()?; }
    Some(PathBuf::from(std::ffi::OsString::from_wide(&buffer[..len as usize])))
}

/// Called only after consent. Never post WM_CLOSE to the plugin's hidden
/// helper window: that would destroy its lock endpoint without exiting.
unsafe extern "system" fn close_app_window(hwnd: HWND, data: LPARAM) -> BOOL {
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == data.0 as u32 {
        let mut title = [0u16; 256];
        let len = GetWindowTextW(hwnd, &mut title);
        if String::from_utf16_lossy(&title[..len as usize]) == "Dynamic Island" {
            let _ = PostMessageW(hwnd, WM_CLOSE, WPARAM(0), LPARAM(0));
        }
    }
    BOOL(1)
}

/// Run before Tauri's single-instance plugin, including for older EXEs whose
/// second-instance callback silently ignores any launch request.
pub fn prepare() -> Option<LaunchGuard> {
    let automatic = std::env::args().any(|arg| arg == "--autostart");
    let fail = |message: &str| { if !automatic { report(message); } };
    let mutex = match unsafe { CreateMutexW(None, false, w!("Local\\com.dynamicisland.app-launch-gate")) } {
        Ok(handle) => handle,
        Err(error) => { fail(&format!("无法检查启动状态：{error}")); return None; }
    };
    let waited = unsafe { WaitForSingleObject(mutex, 5000) };
    if waited != WAIT_OBJECT_0 && waited != WAIT_ABANDONED {
        unsafe { let _ = CloseHandle(mutex); }
        fail("另一个灵动岛正在启动或等待切换确认，请稍后重试。");
        return None;
    }
    let guard = LaunchGuard(mutex.0 as isize);
    let current_path = std::env::current_exe().ok()?;
    loop {
        // Names match tauri-plugin-single-instance 2.x, including v1.3.1 and earlier.
        let Ok(hwnd) = (unsafe { FindWindowW(w!("com.dynamicisland.app-sic"), w!("com.dynamicisland.app-siw")) }) else {
            return Some(guard);
        };
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)); }
        let process = match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE, false, pid) } {
            Ok(handle) => Process(handle),
            Err(_) => { fail("检测到另一个灵动岛，但无法访问它。请先从旧版托盘退出，再启动新版。"); return None; }
        };
        let Some(running_path) = process_path(process.0) else {
            fail("无法读取正在运行的灵动岛路径，请先从托盘退出旧版。");
            return None;
        };
        let running_version = file_version(&running_path);
        let current_version = file_version(&current_path);
        match existing_instance_action(running_path == current_path, running_version, current_version, automatic) {
            ExistingInstanceAction::Forward => return Some(guard),
            ExistingInstanceAction::KeepRunning => {
                if !automatic {
                    fail(&format!("已有更新版本 v{} 正在运行，已保留它。\n\n{}", running_version.unwrap(), running_path.display()));
                }
                return None;
            }
            ExistingInstanceAction::AskToSwitch => {}
        }
        let label = |value: Option<Version>| value.map(|v| format!("v{v}")).unwrap_or_else(|| "未知版本".into());
        let message = format!("检测到另一个灵动岛正在运行。\n\n正在运行：{}\n{}\n\n准备启动：{}\n{}\n\n是否关闭正在运行的版本并切换到此 EXE？\n选择“否”将保留原程序。",
            label(running_version), running_path.display(), label(current_version), current_path.display());
        if unsafe { MessageBoxW(None, &HSTRING::from(message), w!("切换灵动岛版本"), MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2) } != IDYES {
            return None;
        }
        // Normal window close gives the app/WebView time to save settings.
        unsafe { let _ = EnumWindows(Some(close_app_window), LPARAM(pid as isize)); }
        loop {
            if unsafe { WaitForSingleObject(process.0, 5000) } == WAIT_OBJECT_0 { break; }
            if unsafe { MessageBoxW(None,
                w!("原程序尚未退出。请从它的托盘菜单选择“退出”，然后点击“重试”。\n不会强制结束进程；取消则放弃启动此版本。"),
                w!("等待旧版退出"), MB_RETRYCANCEL | MB_ICONINFORMATION) } == IDCANCEL { return None; }
        }
        // Recheck before starting: another legacy copy might have raced us.
    }
}

/// Replace only an existing entry for this application, preserving the user's
/// enabled/disabled choice, including Task Manager's StartupApproved override.
pub fn refresh_autostart(name: &str) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = match hkcu.open_subkey_with_flags(RUN_KEY, KEY_READ | KEY_SET_VALUE) {
        Ok(key) => key,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let current = std::env::current_exe().map_err(|e| e.to_string())?;
    refresh_entry(&key, name, &current).map_err(|e| e.to_string())
}

fn refresh_entry(key: &RegKey, name: &str, current: &Path) -> std::io::Result<()> {
    let command: String = match key.get_value(name) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let registered = command_exe(&command).map(Path::new);
    if !may_update_startup(registered.and_then(file_version), file_version(current)) {
        return Ok(());
    }
    let updated = startup_command(current);
    if command != updated { key.set_value(name, &updated)?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_process_path_without_relying_on_executable_filename() {
        let process = Process(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, std::process::id()).unwrap() });
        assert_eq!(process_path(process.0).unwrap(), std::env::current_exe().unwrap());
    }

    #[test]
    fn graceful_close_targets_app_window_and_leaves_helper_intact() {
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, DispatchMessageW, IsWindow, PeekMessageW,
            MSG, PM_REMOVE, WINDOW_EX_STYLE, WS_OVERLAPPED,
        };
        unsafe {
            // Invisible test windows belong only to this test executable.
            let app = CreateWindowExW(WINDOW_EX_STYLE(0), w!("STATIC"), w!("Dynamic Island"),
                WS_OVERLAPPED, 0, 0, 1, 1, None, None, None, None).unwrap();
            let helper = CreateWindowExW(WINDOW_EX_STYLE(0), w!("STATIC"), w!("com.dynamicisland.app-siw"),
                WS_OVERLAPPED, 0, 0, 1, 1, None, None, None, None).unwrap();
            EnumWindows(Some(close_app_window), LPARAM(std::process::id() as isize)).unwrap();
            let mut message = MSG::default();
            while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                DispatchMessageW(&message);
            }
            let app_closed = !IsWindow(app).as_bool();
            let helper_alive = IsWindow(helper).as_bool();
            if !app_closed { let _ = DestroyWindow(app); }
            let _ = DestroyWindow(helper);
            assert!(app_closed, "the main window receives a normal close request");
            assert!(helper_alive, "the single-instance helper must not be destroyed separately");
        }
    }

    #[test]
    fn migrates_only_existing_entry_in_an_isolated_registry_key() {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let path = format!(r"Software\DynamicIslandTests\{}", std::process::id());
        let (key, _) = hkcu.create_subkey(&path).unwrap();
        let current = std::env::current_exe().unwrap();
        refresh_entry(&key, "missing", &current).unwrap();
        assert!(key.get_value::<String, _>("missing").is_err());
        key.set_value("island", &r"C:\Old App\old.exe --autostart").unwrap();
        key.set_value("unrelated", &"untouched").unwrap();
        refresh_entry(&key, "island", &current).unwrap();
        assert_eq!(key.get_value::<String, _>("island").unwrap(), startup_command(&current));
        assert_eq!(key.get_value::<String, _>("unrelated").unwrap(), "untouched");
        drop(key);
        hkcu.delete_subkey_all(&path).unwrap();
    }
}
