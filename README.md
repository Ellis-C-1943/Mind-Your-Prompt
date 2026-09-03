# Mind Your Prompt / MYP

[English](README.md) | [简体中文](README.zh-CN.md)

MYP is a local-first Windows prompt manager for AIGC image workflows. When it is started through the included local service, the interface runs in a browser while prompts and images remain inside the application's `DATA` directory. Opening `index.html` directly instead uses that browser's IndexedDB.

<!-- github-screenshots:start -->
## Screenshots

![MYP light theme](docs/screenshot-light.png)

![MYP dark theme](docs/screenshot-dark.png)
<!-- github-screenshots:end -->

## Features

- Manage titles, model names, prompts, source images, and generated images.
- Single-image and adaptive grid preview modes.
- Search, text-to-image/image-to-image filters, drag reordering, and order-number swaps.
- Image lightbox, downloads, and prompt copy.
- Dark/light themes, accent colors, and Chinese/English UI.
- No account, cloud backend, external font request, or third-party runtime dependency.
- IndexedDB fallback when `index.html` is opened without the local server.
- Serialized, revision-checked saves and transactional prompt/image deletion.

## Download

For normal use, download the versioned `Mind-Your-Prompt-vX.Y.Z-Windows.zip` from GitHub Releases, extract the complete archive to a writable folder, and then double-click `Start MYP.exe`. Do not run the application from inside the ZIP.

The `Mind-Your-Prompt-vX.Y.Z-Code.zip` package is intended for publishing the source tree to GitHub, source review, and development. It contains CI configuration, tests, developer documentation, and the full-resolution light/dark screenshots, but intentionally excludes generated executables and all user data.

## Requirements

- Windows 10 or Windows 11.
- Built-in Windows PowerShell 5.x.
- A modern browser such as Edge, Chrome, or Firefox.

## Start

### Preferred (Release package): `Start MYP.exe`

Double-click `Start MYP.exe` in the project root. It only launches the local PowerShell service without a visible console window. Its source is `launcher/StartMYP.cs`.

The executable is not commercially code-signed, so Windows may show a SmartScreen notice on first launch. Delete it and use the script entry point below if unsigned executables are unacceptable in your environment.

The Code package does not include the generated EXE. Use the script entry point below, or build the launcher with `launcher/Build-Launcher.ps1`.

### Script entry point: `launch/Start_MYP.bat`

Double-click the batch file to start the same local service.

### Manual PowerShell start

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\server\MYP.ps1
```

The service binds only to `127.0.0.1` on ports `47350–47370` and remains available while an MYP tab is open, including when that tab is backgrounded or idle. After the last MYP tab closes, the service exits after a 10-second grace period; reloading or reopening MYP during that period cancels the shutdown.

## Data and backup

When MYP runs through the local service:

- Prompts: `DATA/prompts.json`
- Previous automatic backup: `DATA/prompts.json.bak`
- Images: `DATA/images/`
- Ephemeral runtime files: `RUNTIME/`

Prompt saves are serialized in the browser and checked against a content revision so stale tabs cannot silently overwrite newer data. Each save uses a same-directory temporary file and prefers an atomic replacement. On filesystems where `File.Replace` is unavailable, MYP falls back to a compatible backup-then-overwrite path. Image deletion and the matching prompt update are committed through one reversible server transaction; interrupted uncommitted deletions are recovered from `RUNTIME/transactions` at the next start.

If the main database is invalid, MYP serves a valid `.bak` without deleting the original; the next successful save preserves the damaged file as `prompts.corrupt-timestamp.json`. Legacy UTF-8 BOM files and older records without grid-order fields remain readable.

Copy the complete `DATA` directory for backup or migration. This remains the complete portable backup: no user content was moved into `RUNTIME` or another location. Do not manually edit `prompts.json` while MYP is saving.

Opening `index.html` directly stores data in that browser's IndexedDB. Browser-only data is separate from the project-folder data and is not synchronized automatically.

## Local security boundary

- Listener restricted to `127.0.0.1`; no LAN or internet binding.
- Mutation endpoints require a random per-launch session token, same-origin request metadata, and JSON content type.
- No CORS permission is emitted; the page also receives CSP and related browser security headers.
- Request sizes, image types, revisions, and filesystem paths are validated.
- JPG/JPEG/PNG only, 80 MB per image, with file-signature validation.
- Path resolution restricted to the project tree and `DATA/images`.

See [SECURITY.md](SECURITY.md) for the complete model.

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

Validation plus the real local-server smoke test:

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Test-Project.ps1 -RunServerSmoke
```

Validation plus the browser interaction/regression suite:

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Test-Project.ps1 -RunBrowserSmoke
```

Release-level validation runs both suites:

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Test-Project.ps1 -RunServerSmoke -RunBrowserSmoke
```

Build a release:

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\tools\Build-Release.ps1
```

The release script rebuilds the launcher in a temporary staging directory, runs server and browser regressions, excludes user data from the package, and generates `SHA256SUMS.txt`. It does not delete user data from the working directory.

## License

MIT License. See [LICENSE](LICENSE).
