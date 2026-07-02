# AGENTS.md — AI 开发操作准则

> 本文档总结了开发此桌面灵动岛（Dynamic Island）过程中踩过的所有坑、
> 验证过的可行方案、以及必须注意的事项。**任何 AI 在开发本项目前必须先读这份文档**，
> 可以避免重复踩坑、节省大量调试时间。

---

## 0. 黄金法则

1. **先验证再推进**：每改一步，先 `cargo check`（秒级）或 `pnpm build`（秒级）确认编译通过，再做下一步。不要攒一堆改动最后一起编译。
2. **不要猜测 API 签名**：遇到编译错误，去 docs.rs / 源码查证真实签名，**绝不靠猜**。本项目的 `windows` crate API 踩坑极多（见 §3）。
3. **诚实报告**：如果某步失败，如实说明失败原因和输出，不要假装成功。
4. **MSIX 版本号必须递增**：每次重新打包安装，`AppxManifest.xml` 的 `Version` 必须比上次大，否则 Windows 不更新。

---

## 1. 环境陷阱（本机特定）

### 1.1 `node` 命令的 tty 死锁
- 在 Git Bash 里直接跑 `node xxx.mjs` 会报 `stdin is not a tty` 并卡死。
- **解法**：用完整路径 `"/c/Program Files/nodejs/node.exe"`。

### 1.2 `makeappx.exe` / `signtool.exe` 的 stdin 死锁
- 通过 bash 直接调用 Windows 控制台程序（makeappx、signtool）会**永久卡死**（bash 的管道包装导致 stdin 阻塞）。
- **解法**：通过 PowerShell 脚本文件（`powershell -File build-msix.ps1`）调用，**不要**在 bash 里直接调。或用 `MSYS_NO_PATHCONV=1` + 重定向到文件再读。

### 1.3 `grep` 在本环境的 bug
- `grep -iE "pattern1|pattern2"` 会报 `conflicting matchers specified`。
- **解法**：用单个 pattern，或 `grep -i "word"`，或把输出重定向到文件再 grep 文件。

### 1.4 winget 不可用
- `winget --version` 在非交互 shell 里不输出。
- **解法**：不要依赖 winget 装工具。用 NuGet API 直接下载（见 §5）。

### 1.5 GitHub 下载超时
- `curl github.com/...` 在本机经常超时。
- **解法**：NuGet（`api.nuget.org`）通常可达，优先用 NuGet 源。

---

## 2. Windows 通知监听（UserNotificationListener）

### 2.1 必须有 MSIX 包身份
- `UserNotificationListener` **绝对无法**在解包 exe（`tauri dev`）下工作。这是 Windows API 的硬限制，不是 bug。
- **解法**：打包成 MSIX。dev 模式用演示数据驱动 UI。
- 身份探测：`windows::ApplicationModel::Package::Current().is_ok()` —— 解包返回 `Err(0x80073D54)`。

### 2.2 用轮询模式，不要用事件监听
- ✅ **可行**：前端每 2.5s 调一次 Rust 命令，后端 fire-and-forget `RequestAccessAsync()` + `GetNotificationsAsync(Toast).get()`，在 tokio worker 线程跑。
- ❌ **不可行**：长驻 WinRT 事件监听器（`NotificationChanged`）—— 需要 STA 消息泵，和 Tauri 的线程模型冲突，且授权弹窗被 `focusable:false` 抑制。
- 参考 NetSpeed-Dynamic 项目的做法（poll-based）。

### 2.3 Toast 内容解析路径
- ✅ **正确**：`notification.Notification().Visual().GetBinding("ToastGeneric").GetTextElements()` → 遍历 text。
- ❌ **错误**：`cast::<ToastNotification>().Content().SelectNodes("//text")` —— 这条路径在某些通知上拿不到文本。

### 2.4 授权弹窗
- 授权弹窗**不是代码触发的**，是**包身份**触发的。有 MSIX + manifest 声明 `userNotificationListener` 能力，系统会处理。
- 如果之前授权被拒，去 **设置 → 通知** 重新开关，代码不会重新弹窗。

### 2.5 微信/QQ 监听不到是正常的
- 微信桌面版用**自绘弹窗**，不走 Windows Toast 通知中心。`UserNotificationListener` 收不到。这是微信的设计，不是 bug。
- 能监听到的：邮件、日历、Teams、Edge、Chrome、系统通知、任何调用标准 Toast API 的应用。

---

## 3. `windows` crate 的版本与 API 陷阱

### 3.1 版本选择
- ✅ **用 `windows = "0.58"`**：有 `IAsyncOperation::get()`，阻塞调用简单直接。
- ❌ **避免 `windows = "0.62"`**：`get()` 被移除，改用 `IntoFuture`/`.await`，在同步上下文里极其麻烦（要 `block_on`，且 trait 可能没导出）。

### 3.2 0.62 的异步处理（如果被迫用）
- `.get()` 没了，只能 `op.await`（需要 async 上下文）。
- 在 `spawn_blocking` 线程里用 `tauri::async_runtime::block_on(async { op.await })`。
- 但实测 `IntoFuture` 可能不在作用域，需要 `use std::future::IntoFuture`。

### 3.3 已验证的 cargo features（0.58）
```toml
windows = { version = "0.58", features = [
    "Foundation", "Foundation_Collections", "Data_Xml_Dom",
    "Storage_Streams", "Graphics_Imaging",
    "UI_Notifications", "UI_Notifications_Management",
    "ApplicationModel",
    "Win32_Foundation", "Win32_System_Com", "Win32_UI_WindowsAndMessaging",
] }
```

### 3.4 常见 API 名纠错
| 错误 | 正确 |
|---|---|
| `NotificationKinds::NewToast` | `NotificationKinds::Toast` |
| `NotificationListenerAccessStatus` | `UserNotificationListenerAccessStatus` |
| `ReadAllNotificationsAsync()` | `GetNotificationsAsync(NotificationKinds::Toast)` |
| `cast::<ToastNotification>()` 解析 XML | `Visual().GetBinding("ToastGeneric").GetTextElements()` |
| `AppId()` 取来源 | `AppInfo().DisplayInfo().DisplayName()` |
| `SelectNodes(&str)` | `SelectNodes(&HSTRING::from("//text"))` |
| `NotificationChanged` 返回 `EventRegistrationToken` | 返回裸 `i64` |

---

## 4. Tauri 透明窗 + 灵动岛

### 4.1 窗口配置
```jsonc
{
  "transparent": true, "decorations": false, "alwaysOnTop": true,
  "skipTaskbar": true, "resizable": false, "focusable": true, "focus": true,
  "shadow": false, "hiddenTitle": true
}
```
- `focusable: true` 在配置里（否则 `set_focus` 无效），但**启动后立即 `set_focusable(false)`**，防止抢焦点。
- Cargo.toml 需要 `tauri = { features = ["macos-private-api", "tray-icon"] }`。

### 4.2 点击穿透（click-through）的正确做法
- 透明窗大部分区域是死区，必须 `setIgnoreCursorEvents(true)` 让点击穿透到下面的应用。
- **但**：穿透时窗口收不到鼠标事件，无法检测 hover。
- **解法**：后端开一个线程，每 50ms 用 `GetCursorPos` 轮询光标位置，判断是否在药丸矩形内（`overPill`）/ 屏幕顶部热区（`hovering`），emit 事件给前端。
- 前端根据 `overPill` 动态切换 `setIgnoreCursorEvents`：光标在药丸上 → 不穿透（可交互）；否则 → 穿透。

### 4.3 窗口尺寸固定，pill 用 CSS 形变
- ❌ **不要**每次切状态就 `set_size` 重缩原生窗口 —— 原生 resize 会裁切正在 CSS 动画中的 pill，产生撕裂。
- ✅ **固定窗口尺寸**（如 480×400），pill 纯 CSS `animate({width,height,borderRadius})` 形变。

### 4.4 透明窗的已知 bug + workaround
- **白底直到 resize**（Tauri #8632）：启动时 nudge size +1px 再恢复。
- **skipTaskbar 偶发失效**（#10422）：每次定位时重新 `set_skip_taskbar(true)`。
- **置顶被遮挡**：每次定位时重新 `set_always_on_top(true)`。

### 4.5 顶居中定位
```rust
let x = (mon_w_logical - win_w_logical) / 2.0;
let y = 0.0; // 贴顶
window.set_position(LogicalPosition::new(x, y));
```

---

## 5. MSIX 打包（无需完整 Windows SDK）

### 5.1 获取 makeappx + signtool
本机没有 Windows SDK。从 NuGet 下载 `Microsoft.Windows.SDK.BuildTools`（22MB，仅含工具）：
```bash
curl -sL -o sdkbuildtools.nupkg \
  "https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.buildtools/10.0.26100.1742/microsoft.windows.sdk.buildtools.10.0.26100.1742.nupkg"
unzip sdkbuildtools.nupkg -d sdktools
# 工具在 sdktools/bin/10.0.26100.0/x64/{makeappx.exe,signtool.exe}
```

### 5.2 证书生成（不需管理员）
```powershell
New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=Dynamic Island Dev" ...
Export-PfxCertificate ...  # 生成 .pfx
```
信任证书（导入 LocalMachine\Root + TrustedPeople）**需要管理员**，这部分让用户手动跑。

### 5.3 AppxManifest.xml 的坑
- `VisualElements` 用 `DisplayName`（不是 `AppName`）。
- `<rescap:Capability Name="runFullTrust"/>` 必须在 `<DeviceCapability>` **之前**。
- `BackgroundColor="transparent"` 不合法，用颜色值如 `"#0c0c0e"`。
- 能力声明：`<DeviceCapability Name="userNotificationListener"/>`（注意是 DeviceCapability，不是 uap:Capability）。

### 5.4 打包签名流程
1. 升版本号（`AppxManifest.xml` Version 必须 > 已安装版本）。
2. staging：拷贝 exe + manifest + icons。
3. `makeappx pack /d staging /p out.msix /nv`（`/nv` 跳过部分校验）。
4. `signtool sign /fd SHA256 /f cert.pfx /p password out.msix`。
5. 卸载旧版 `Remove-AppxPackage` → `Add-AppxPackage` 装新版。

---

## 6. motion（React）动画准则

### 6.1 不要混用 `layout` 和显式 `animate`
- ❌ 同时给一个 `motion.div` 设 `layout` + `animate={{width, height}}` —— 两者会**互相打架**，形变卡顿/抖动。
- ✅ 形变只用 `animate={width/height/borderRadius}` + `transition={spring}`，不加 `layout`。

### 6.2 状态间几何尺寸不要差太大
- pill 从 `hidden(8px高)` 直接跳到 `compact(60px高)` 会剧烈抖动。
- ✅ 中间经过 idle 态：`hidden → idle(60ms) → compact`，高度连续增长。
- ✅ 离开时 `expanded → compact`（平滑收拢），**不要** `expanded → hidden`（30倍跳变）。

### 6.3 hidden 和 idle 宽度要一致
- 否则 hover 召唤时宽度先变窄再变高，闪。
- ✅ 两者都设 150px 宽，hover 时只动高度。

### 6.4 Spring 参数参考
- 形变（morph）：`{ type: "spring", stiffness: 380, damping: 30 }` —— 紧致不弹。
- 滑入（slide）：`{ type: "spring", stiffness: 300, damping: 28 }` —— 稍柔和。

### 6.5 内容切换用 AnimatePresence
- `mode="popLayout"` + `initial={false}` 避免首次渲染动画。
- 内容 `key` 要稳定（用通知 id，不用 index）。

---

## 7. 项目结构与关键文件

```
src/                          React 前端
├── components/
│   ├── DynamicIsland.tsx     核心：状态机 + motion 形变 + 点击穿透
│   ├── NotificationList.tsx  通知列表（点击展开完整内容）
│   ├── NotificationView.tsx  紧凑态单条通知
│   └── IdlePill.tsx          待机态（呼吸点+时钟）
├── hooks/useNotifications.ts 轮询通知 + 状态机 + 声音
├── lib/
│   ├── tauri.ts              IPC 封装（浏览器降级）
│   ├── types.ts              共享类型
│   └── sound.ts              Web Audio 提示音
└── store/islandStore.ts      zustand 状态

src-tauri/src/                Rust 后端
├── lib.rs                    Tauri builder + 托盘 + 单实例 + 命令
├── notification_listener.rs  轮询式通知捕获（windows 0.58）
├── identity.rs               包身份探测
├── window_setup.rs           定位 + 光标监听 + 透明窗 workaround
└── notifications.rs          serde 类型

src-tauri/packaging/          MSIX 打包
├── AppxManifest.xml          包身份 + userNotificationListener 能力
├── build-msix.ps1            打包签名脚本
└── sdktools/                 从 NuGet 提取的 makeappx/signtool（gitignore）
```

---

## 8. 常用命令速查

```bash
# 开发（解包模式，演示数据）
pnpm tauri dev

# 仅前端（浏览器调试，IPC 降级为空操作）
pnpm dev

# 构建前端
pnpm build

# Rust 增量检查（秒级，先跑这个）
cd src-tauri && cargo check

# 构建 release exe
pnpm tauri build --no-bundle

# 打包 + 签名 MSIX（通过 PowerShell 脚本，避免 bash 死锁）
powershell -ExecutionPolicy Bypass -File "...\build-msix.ps1" -PfxPath "...\DynamicIslandDev.pfx"

# 卸载旧版 + 装新版
powershell -Command "Get-AppxPackage *DynamicIsland* | Remove-AppxPackage"
powershell -Command "Add-AppxPackage -Path '...\DynamicIsland.msix'"

# 启动 MSIX 应用
powershell -Command "Start-Process 'shell:AppsFolder\DynamicIsland_6dz8pfzja490c!App'"

# 发测试 Toast（验证通知捕获）
# 见 §2 的 PowerShell 脚本

# git 提交推送
git add -A && git commit -m "中文描述" && git push origin main
```

---

## 9. 测试通知的方法

用 PowerShell 发一条真实 Toast，2.5s 后灵动岛应捕获：
```powershell
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$t.GetElementsByTagName('text').Item(0).AppendChild($t.CreateTextNode('测试')) | Out-Null
$t.GetElementsByTagName('text').Item(1).AppendChild($t.CreateTextNode('通知内容')) | Out-Null
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Test').Show([Windows.UI.Notifications.ToastNotification]::new($t))
```
```

---

## 10. 已知限制（诚实声明）

- **微信/QQ/钉钉**：自绘弹窗，不走系统通知，监听不到（API 限制，非 bug）。
- **自签名证书**：仅本机可信，分发需正式代码签名证书。
- **dev 模式**：无法捕获真实通知（无包身份），靠演示数据。
- **应用图标**：依赖 `AppDisplayInfo.GetLogo()`，部分应用无图标，回退首字母。
- **Store 上架**：`userNotificationListener` 是受限能力，需合作伙伴审批。

---

_最后更新：开发完成时。如遇新坑，请补充到对应章节。_
