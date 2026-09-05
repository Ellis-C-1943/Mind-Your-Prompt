# Mind Your Prompt / MYP

[English](README.md) | [简体中文](README.zh-CN.md)

MYP 是我为了自己的 AIGC 图片工作流做的一个本地提示词管理工具。做它的原因很简单：提示词、模型名、原图和生成结果越来越多以后，分散在文件夹和笔记里很难管理，所以我想把这些东西放到一个地方。它主要面向 Windows 使用，工作数据保存在本地。

<!-- github-screenshots:start -->
## 界面截图

![MYP 浅色主题](docs/screenshot-light.png)

![MYP 深色主题](docs/screenshot-dark.png)
<!-- github-screenshots:end -->

## 功能

- 在一个界面里管理标题、模型名、提示词、原图和生成图。
- 支持单图预览和自适应网格预览。
- 支持搜索，以及文生图 / 图生图筛选。
- 支持拖动排序和编号互换。
- 支持图片灯箱预览、下载和提示词快速复制。
- 支持深浅主题、强调色和中英文界面。
- 数据默认保存在本地，不需要账号或云端后端。
- 直接打开 `index.html` 时，可使用浏览器 IndexedDB 保存数据。

## 下载

普通使用请从 GitHub Releases 下载带版本号的 `Mind-Your-Prompt-vX.Y.Z-Windows.zip`，完整解压到可写文件夹后，双击 `Start MYP.exe`。请勿直接在 ZIP 压缩包内运行。

`Mind-Your-Prompt-vX.Y.Z-Code.zip` 是用于查看源码和开发的代码包，不包含生成的 EXE 和用户数据。

## 系统要求

- Windows 10 或 Windows 11。
- 系统自带的 Windows PowerShell 5.x。
- Edge、Chrome 或 Firefox 等现代浏览器。

## 启动

### 首选（Release 包）：`Start MYP.exe`

双击项目根目录的 `Start MYP.exe` 即可启动本地服务，并且不会保留可见的 PowerShell 窗口。启动器源码位于 `launcher/StartMYP.cs`。

该 EXE 没有商业代码签名，因此 Windows 首次运行时可能显示 SmartScreen 提示。如果不希望运行未签名 EXE，可以直接使用下面的脚本入口。

Code 包不包含生成后的 EXE，可使用下面的脚本入口，或运行 `launcher/Build-Launcher.ps1` 自行构建启动器。

### 脚本入口：`launch/Start_MYP.bat`

双击该文件即可启动同一套本地服务。

### PowerShell 手动启动

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\server\MYP.ps1
```

服务只监听 `127.0.0.1`，端口范围为 `47350–47370`。只要还有 MYP 标签页打开，服务就会保持运行；最后一个 MYP 标签页关闭后会自动退出。

## 数据与备份

通过本地服务运行时：

- 提示词：`DATA/prompts.json`
- 上一版自动备份：`DATA/prompts.json.bak`
- 图片：`DATA/images/`
- 临时运行文件：`RUNTIME/`

备份或迁移时，复制整个 `DATA` 文件夹即可。MYP 同时做了保存冲突检查、自动备份，以及写入或删除被意外中断时的恢复处理。

直接打开 `index.html` 时，数据会保存在当前浏览器的 IndexedDB 中；这部分数据与项目目录里的数据相互独立，不会自动同步。

更具体的实现说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 本地安全

- 本地服务只绑定 `127.0.0.1`，不会监听局域网或公网。
- 用户数据保存在本地项目目录。
- 对上传类型、请求大小和文件路径进行校验。

完整安全说明见 [SECURITY.md](SECURITY.md)。

## Code 包结构

```text
Mind Your Prompt data/
├─ index.html
├─ MYP.ps1
├─ assets/
│  ├─ css/                 # 按职责拆分的样式模块
│  ├─ js/app/              # 应用状态、数据模型、持久化、列表、舞台、编辑器和启动模块
│  ├─ js/storage.js        # IndexedDB 降级存储
│  └─ js/i18n.js
├─ DATA/
│  └─ images/
├─ server/MYP.ps1
├─ launcher/
├─ launch/
├─ tools/
└─ docs/
```

模块边界和状态所有权见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 开发与发布

本节命令适用于 Code 包。浏览器回归测试和默认 Release 构建需要 Node.js，以及 Edge、Chrome 或其他 Chromium 浏览器；如果脚本无法自动找到浏览器，请设置 `CHROME_PATH`。

静态检查：

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Test-Project.ps1
```

本地服务烟雾测试：

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Test-Project.ps1 -RunServerSmoke
```

浏览器交互与回归测试：

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Test-Project.ps1 -RunBrowserSmoke
```

发布级检查：

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Test-Project.ps1 -RunServerSmoke -RunBrowserSmoke
```

构建发布包：

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Build-Release.ps1
```

发布脚本会重新构建启动器、运行服务端和浏览器回归测试、排除用户数据，并生成 `SHA256SUMS.txt`。

## 许可证

MIT License。详见 [LICENSE](LICENSE)。
