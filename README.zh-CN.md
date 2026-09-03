# Mind Your Prompt / MYP

[English](README.md) | [简体中文](README.zh-CN.md)

MYP 是一个面向 AIGC 图片工作流的 Windows 本地提示词管理工具。通过随附的本地服务启动时，界面运行在浏览器中，提示词和图片保存在应用目录的 `DATA` 文件夹内；直接打开 `index.html` 时则使用该浏览器的 IndexedDB。

<!-- github-screenshots:start -->
## 界面截图

![MYP 浅色主题](docs/screenshot-light.png)

![MYP 深色主题](docs/screenshot-dark.png)
<!-- github-screenshots:end -->

## 功能

- 管理标题、模型名、提示词、原图和生成图。
- 单图预览与自适应网格预览。
- 搜索、文生图/图生图筛选、拖动排序和编号互换。
- 图片灯箱预览、下载与提示词复制。
- 深浅主题、强调色和中英文界面。
- 无云端账号、无外部字体、无第三方运行时依赖。
- 直接打开 `index.html` 时使用 IndexedDB 作为浏览器内降级存储。
- 保存请求串行化、版本冲突校验，以及提示词与图片删除事务。

## 下载

普通用户请从 GitHub Releases 下载带版本号的 `Mind-Your-Prompt-vX.Y.Z-Windows.zip`，将完整压缩包解压到可写文件夹，再双击 `Start MYP.exe`。请勿在 ZIP 压缩包内直接运行。

`Mind-Your-Prompt-vX.Y.Z-Code.zip` 用于将源码发布到 GitHub、审阅源码及开发；其中包含 CI 配置、测试、开发文档和浅色/深色全分辨率截图，但有意不包含生成的 EXE 和任何用户数据。

## 系统要求

- Windows 10 或 Windows 11。
- 系统自带的 Windows PowerShell 5.x。
- Edge、Chrome 或 Firefox 等现代浏览器。

## 启动

### 首选（Release 包）：`Start MYP.exe`

双击项目根目录的 `Start MYP.exe`。它只负责隐藏 PowerShell 窗口并启动本地服务，源码位于 `launcher/StartMYP.cs`。

该 EXE 未进行商业代码签名，Windows 首次运行时可能显示 SmartScreen 提示。无法接受未签名程序时，可删除 EXE，改用下面的脚本入口。

Code 包不包含生成的 EXE；可使用下面的脚本入口，或运行 `launcher/Build-Launcher.ps1` 构建启动器。

### 脚本入口：`launch/Start_MYP.bat`

双击该文件即可启动同一套本地服务。

### PowerShell 手动启动

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\server\MYP.ps1
```

服务只监听 `127.0.0.1`，端口范围为 `47350–47370`。只要仍有 MYP 标签页打开，即使页面进入后台或长期不操作，服务也会保持 DATA 读写能力；最后一个 MYP 标签页关闭后进入 10 秒宽限期，期间刷新或重新打开会取消退出，否则服务自动关闭。

## 数据与备份

通过本地服务运行时：

- 提示词：`DATA/prompts.json`
- 上一版自动备份：`DATA/prompts.json.bak`
- 图片：`DATA/images/`
- 临时运行文件：`RUNTIME/`

浏览器会将保存请求严格串行执行，并使用内容版本号阻止旧标签页静默覆盖新数据。保存提示词时会先写入同目录临时文件，并优先使用原子替换；文件系统不支持 `File.Replace` 时，会自动降级为“先备份、再覆盖”的兼容保存。图片删除与对应的提示词更新通过同一个可回滚事务提交；未提交事务中的图片会在下次启动时从 `RUNTIME/transactions` 恢复。

主数据库文件无效时，MYP 会读取有效的 `.bak`，同时保留原文件；下一次成功保存时再将损坏文件留存为 `prompts.corrupt-日期时间.json`。带 UTF-8 BOM 的旧数据库、缺少网格排序字段的旧项目均可直接读取。

迁移或备份时仍然只需复制整个 `DATA` 文件夹。所有用户内容仍位于该目录，没有迁移到 `RUNTIME` 或其他位置。不要在 MYP 正在保存时手动编辑 `prompts.json`。

直接双击 `index.html` 时，数据保存在当前浏览器的 IndexedDB 中，不会写入 `DATA`，也不会与本地服务模式自动同步。

## 本地安全边界

- 服务仅绑定 `127.0.0.1`，不绑定局域网或公网。
- 所有修改接口必须提供每次启动随机生成的会话令牌、同源请求信息和 JSON Content-Type。
- 不向其他网站开放 CORS 权限，首页同时启用 CSP 等浏览器安全响应头。
- 对请求大小、图片类型、数据版本和文件路径进行限制与校验。
- 图片限制为 JPG、JPEG、PNG，单张最大 80 MB，并校验文件签名。
- 所有路径都会限制在项目目录或 `DATA/images` 内。

完整说明见 [SECURITY.md](SECURITY.md)。

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

包含真实本地服务的烟雾测试：

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Test-Project.ps1 -RunServerSmoke
```

包含真实浏览器交互与回归测试的测试：

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Test-Project.ps1 -RunBrowserSmoke
```

发布级检查同时运行两套测试：

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Test-Project.ps1 -RunServerSmoke -RunBrowserSmoke
```

构建发布包：

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Build-Release.ps1
```

发布脚本会在临时目录重新编译启动器、运行服务端与浏览器回归、从发布包中排除用户数据，并生成 `SHA256SUMS.txt`；它不会删除工作目录中的用户数据。

## 许可证

MIT License。详见 [LICENSE](LICENSE)。
