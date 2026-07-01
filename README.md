# 桌面灵动岛 · Dynamic Island

一个 Windows 桌面版「灵动岛」：屏幕顶部居中的胶囊形悬浮窗，Hook 全系统 Toast 通知并用流畅的弹性形变动画展示，支持 **待机 / 紧凑 / 展开** 三态切换。

技术栈：**Tauri v2 · React · TypeScript · TailwindCSS v4 · [motion](https://motion.dev)**。通知捕获使用 Windows 官方 **`UserNotificationListener`** API（经 Rust `windows` crate 调用）。

---

## ✨ 功能

- **三态形变动画**：`idle`（时钟 + 呼吸点）↔ `compact`（通知预览，5.5s 自动收回）↔ `expanded`（完整内容 + 关闭按钮）。用 `motion` 的 `layout` + spring 物理实现胶囊形变，非淡入淡出。
- **系统通知 Hook**：捕获所有应用的 Toast（标题/正文/来源应用）。基于官方 `UserNotificationListener`。
- **透明置顶悬浮**：透明背景、无标题栏、永不抢焦点、不出现在任务栏、始终置顶，顶部居中（自动适配多显示器）。
- **智能点击穿透**：待机时整窗点击穿透，不打扰操作；有通知时可悬停展开/点击切换。通过「窗口随内容收缩」消除透明死区。
- **开发降级**：解包运行时自动用内置演示通知驱动 UI，无需打包即可调试视觉与动画。

---

## 🚀 快速开始

### 环境要求
- [Node.js](https://nodejs.org/) ≥ 18（推荐 22）
- [pnpm](https://pnpm.io/) ≥ 9
- [Rust](https://rustup.rs/)（stable，含 `cargo`）
- Windows 10 2004 (19041) 及以上（MSIX 打包需要）
- Windows SDK（打包时需要 `MakeAppx`、`SignTool`，通常已随 Visual Studio / SDK 安装）

### 安装依赖
```bash
pnpm install
```

### 开发模式（演示数据）
```bash
pnpm tauri dev
```
> ⚠️ **重要**：`tauri dev` 以**解包**方式运行，没有 MSIX 包身份，因此 `UserNotificationListener` **无法**捕获真实通知。这是 Windows API 的硬性限制，不是 bug。此时灵动岛会用**内置演示通知**（每 12s 一条）驱动动画，方便你打磨视觉。

### 仅前端开发（浏览器调试）
```bash
pnpm dev
```
浏览器中也能看到 UI（IPC 调用会安全降级为空操作）。

---

## 🔔 真实通知捕获（需要 MSIX 打包）

`UserNotificationListener` 要求进程有**包身份（package identity）**，普通 exe 调不通。必须打包成 MSIX。

### 步骤

**1. 创建自签名证书**（管理员 PowerShell，每台机器只需一次）：
```powershell
powershell -ExecutionPolicy Bypass -File src-tauri\packaging\make-dev-cert.ps1
```
这会创建一个自签名代码签名证书，并安装到本机「受信任的根」和「受信任人」存储。

**2. 构建 + 签名（+ 安装）MSIX**：
```powershell
# 仅构建并签名
powershell -ExecutionPolicy Bypass -File src-tauri\packaging\build-msix.ps1
# 构建 + 签名 + 安装
powershell -ExecutionPolicy Bypass -File src-tauri\packaging\build-msix.ps1 -Install
```
脚本会：`pnpm tauri build` → 暂存 exe + 图标 + `AppxManifest.xml` → `MakeAppx pack` → `SignTool sign` → （可选）`Add-AppxPackage`。

**3. 首次运行授权**：从开始菜单启动「Dynamic Island」。应用启动时会调用 `RequestAccessAsync()`，首次会弹出系统授权提示（或在 **Windows 设置 → 通知** 中允许本应用读取通知）。授权后即可实时捕获所有应用的通知。

> 📌 `AppxManifest.xml` 中通过 `<DeviceCapability Name="userNotificationListener"/>` 声明此受限能力。侧载/企业内使用无需 Store 审批；上架 Microsoft Store 需合作伙伴审批。

---

## 🏗️ 架构

```
src/                      React 前端
├── components/
│   ├── DynamicIsland.tsx     核心：motion 容器 + 状态机 + 窗口收缩/点击穿透
│   ├── IdlePill.tsx          待机态（呼吸点 + 时钟）
│   └── NotificationView.tsx  紧凑/展开通知内容
├── hooks/useNotifications.ts IPC 订阅 + 自动收回状态机 + 演示数据
├── lib/
│   ├── tauri.ts              IPC 封装（在浏览器中安全降级）
│   └── types.ts              与 Rust 共享的类型 + 各模式窗口尺寸
└── store/islandStore.ts      zustand：通知队列 + 显示模式

src-tauri/src/            Rust 后端
├── lib.rs                Tauri builder、命令（resize / status / demo / dismiss）
├── identity.rs           包身份探测（Package::Current()）
├── notification_listener.rs  UserNotificationListener 封装（MTA + Tokio await）
├── notifications.rs      serde 类型 + 事件名常量
└── window_setup.rs       顶居中定位 + 透明窗 workaround
```

### 关键设计

- **动画**：外层 `motion.div` 用 `layout` + `animate` 在三态间弹性形变（`spring stiffness:420 damping:34`），内容用 `AnimatePresence mode="popLayout"` 实现「同一个胶囊变形」而非切换。
- **点击穿透**：采用「窗口尺寸随内容收缩」策略——待机时窗口缩到药丸大小，几乎无透明死区，可见像素均可交互；配合 `setIgnoreCursorEvents` 精细控制。
- **异步模型**：WinRT 监听运行在 Tauri 的 Tokio 运行时上（MTA COM），直接 `.await` `IAsyncOperation`，无需 Win32 消息泵。`NotificationChanged` 事件回调内派发异步任务重读通知集并 diff 增删。

### 事件 / 命令
| 方向 | 名称 | 用途 |
|---|---|---|
| Rust → FE | `island://notification` | 新通知 |
| Rust → FE | `island://notification-removed` | 通知被移除 |
| Rust → FE | `island://listener-status` | 监听可用性变化 |
| FE → Rust | `resize_island(w,h)` | 收缩窗口贴合内容 |
| FE → Rust | `get_listener_status` | 拉取状态 |
| FE → Rust | `push_demo_notification` | 演示通知 |

---

## ⚠️ 已知限制

- **自签名证书仅本机可信**：分发需正式代码签名证书。
- **受限能力**：`userNotificationListener` 上架 Microsoft Store 需合作伙伴审批。
- **部分应用**通知可能无可解析文本；图标/富媒体 v1 暂未深入。
- **Windows 透明窗**：对 Tauri 已知 bug（#8632 透明窗首次需 resize、#10422 skipTaskbar 偶发）已内置 workaround。
- **dev 模式无法真实监听**：解包运行调不通官方 API，靠演示数据——是 API 固有限制。

---

## 📜 脚本

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 仅前端，浏览器调试 |
| `pnpm build` | `tsc` + `vite build` 产物 |
| `pnpm tauri dev` | 解包开发（演示数据） |
| `pnpm tauri build` | 构建 release exe + NSIS/MSI 安装包 |
| `node src-tauri/icons/gen-icons.mjs` | 重新生成占位图标 |
