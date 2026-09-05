# Mind Your Prompt / MYP

[English](README.md) | [简体中文](README.zh-CN.md)

MYP is a local prompt manager I built for my own AIGC image workflow. I wanted one place to keep prompts, model names, source images, and generated results together instead of scattering them across folders and notes. It is designed for Windows and keeps the working data local.

<!-- github-screenshots:start -->
## Screenshots

![MYP light theme](docs/screenshot-light.png)

![MYP dark theme](docs/screenshot-dark.png)
<!-- github-screenshots:end -->

## Features

- Manage prompt titles, model names, prompts, source images, and generated images in one place.
- Switch between single-image and adaptive grid previews.
- Search and filter text-to-image / image-to-image entries.
- Reorder items by dragging or swapping order numbers.
- Preview images in a lightbox, download images, and copy prompts quickly.
- Dark/light themes, accent colors, and Chinese/English UI.
- Local storage with no account or cloud backend required.
- Browser-only IndexedDB fallback when `index.html` is opened directly.

## Download

For normal use, download the versioned `Mind-Your-Prompt-vX.Y.Z-Windows.zip` from GitHub Releases, extract the archive to a writable folder, and double-click `Start MYP.exe`. Do not run the application from inside the ZIP.

The `Mind-Your-Prompt-vX.Y.Z-Code.zip` package is the source package for review and development. It does not include the generated EXE or user data.

## Requirements

- Windows 10 or Windows 11.
- Built-in Windows PowerShell 5.x.
- A modern browser such as Edge, Chrome, or Firefox.

## Start

### Preferred (Release package): `Start MYP.exe`

Double-click `Start MYP.exe` in the project root. It launches the local PowerShell service without leaving a visible console window. The launcher source is in `launcher/StartMYP.cs`.

The executable is not commercially code-signed, so Windows may show a SmartScreen notice on first launch. If you prefer not to run an unsigned EXE, use the script entry point below.

The Code package does not include the generated EXE. Use the script entry point below, or build the launcher with `launcher/Build-Launcher.ps1`.

### Script entry point: `launch/Start_MYP.bat`

Double-click the batch file to start the same local service.

### Manual PowerShell start

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\server\MYP.ps1
```

The service binds only to `127.0.0.1` on ports `47350–47370`. It stays available while an MYP tab is open and shuts down shortly after the last MYP tab is closed.

## Data and backup

When MYP runs through the local service:

- Prompts: `DATA/prompts.json`
- Previous automatic backup: `DATA/prompts.json.bak`
- Images: `DATA/images/`
- Temporary runtime files: `RUNTIME/`

Copy the complete `DATA` directory to back up or move your prompt library. MYP also includes save-conflict checks, automatic backup, and recovery handling for interrupted writes or deletions.

Opening `index.html` directly stores data in that browser's IndexedDB. Browser-only data is separate from the project-folder data and is not synchronized automatically.

For implementation details, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Local security

- The local service binds only to `127.0.0.1`, not the LAN or internet.
- User data remains in the local project directory.
- Upload types, request sizes, and filesystem paths are validated.

See [SECURITY.md](SECURITY.md) for the full security model.

## Code package layout

```text
Mind Your Prompt data/
├─ index.html
├─ MYP.ps1
├─ assets/
│  ├─ css/                 # responsibility-based style modules
│  ├─ js/app/              # state, prompt model, persistence, list, stage, editor, preferences, bootstrap
│  ├─ js/storage.js        # IndexedDB fallback
│  └─ js/i18n.js
├─ DATA/
│  └─ images/
├─ server/MYP.ps1
├─ launcher/
├─ launch/
├─ tools/
└─ docs/
```

Module boundaries and state ownership are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development and release

The commands in this section are for the Code package. Browser regression tests and the default release build require Node.js plus Edge, Chrome, or another Chromium browser; set `CHROME_PATH` if the browser is not discovered automatically.

Static validation:

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Test-Project.ps1
```

Validation plus the local-server smoke test:

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Test-Project.ps1 -RunServerSmoke
```

Browser interaction/regression suite:

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Test-Project.ps1 -RunBrowserSmoke
```

Release-level validation:

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Test-Project.ps1 -RunServerSmoke -RunBrowserSmoke
```

Build a release:

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Build-Release.ps1
```

The release script rebuilds the launcher, runs the server and browser regressions, excludes user data from the package, and generates `SHA256SUMS.txt`.

## License

MIT License. See [LICENSE](LICENSE).
