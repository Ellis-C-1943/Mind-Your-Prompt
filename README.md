# Mind Your Prompt / MYP

Mind Your Prompt / MYP is a local-first prompt manager for AIGC image workflows.

![Mind Your Prompt screenshot](docs/screenshot.jpg)

MYP is built as a small Windows folder that opens in the browser, stores prompts and images locally, and can be backed up by copying one `DATA` folder.

## Features

- Local-first: data stays in the project folder when launched through the local server.
- Browser-based UI built with native HTML, CSS, and JavaScript.
- No Electron, no Node.js, no npm, no Vite, no Webpack, no React, no Vue, and no Svelte.
- No account, no cloud sync, no remote upload backend, and no external font request.
- Prompt title, model name, prompt text, input image, and output image management.
- Search, text-to-image / image-to-image filters, image preview lightbox, image download, and prompt copy.
- Theme switching, accent color switching, and Chinese/English UI switching.
- `DATA` folder backup and migration.
- IndexedDB fallback when `index.html` is opened directly without the local server.

## Windows requirements

- Windows 10 or Windows 11.
- Built-in Windows PowerShell 5.x.
- A modern browser such as Edge, Chrome, or Firefox.

## How to start

### 1. Optional launcher: double-click `Start MYP.exe`

- `Start MYP.exe` is a release convenience launcher, not a required runtime dependency.
- It opens the local browser front end automatically.
- It starts the local PowerShell service without keeping a visible console window open.
- Windows may show a SmartScreen warning on first run because the EXE is unsigned.

If you do not trust unsigned EXE files, delete `Start MYP.exe` and use the script-only launcher below.

### 2. Script-only launcher: double-click `launch/Start_MYP.bat`

- Does not run the EXE launcher.
- Starts the same local PowerShell service.
- Automatically opens the browser.
- Works after moving the project folder, including paths with spaces.

### 3. Manual PowerShell start

From the project root, run:

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\server\MYP.ps1
```

The browser opens a local page such as:

```txt
http://127.0.0.1:47350/
```

## Windows SmartScreen notice

`Start MYP.exe` is an unsigned optional launcher. Windows may show a SmartScreen warning the first time you run it.

MYP does not require the EXE launcher. You can delete `Start MYP.exe` and start MYP with:

```powershell
launch\Start_MYP.bat
```

## Local service lifecycle

- The local service listens only on `127.0.0.1`.
- MYP does not start with Windows.
- MYP does not register a Windows service.
- MYP does not create a scheduled task.
- MYP does not stay resident in the background after use.
- The front end requests `/api/health` every 5 seconds while the MYP tab is open.
- After the MYP browser tab is closed, the local service exits automatically after about 20 seconds of idle time.
- If MYP is already running, launching it again opens the existing local page instead of starting another service instance.
- `RUNTIME/` is created at runtime for temporary files such as `server.log` and `server.port`.

## Data location

When started with `Start MYP.exe` or `launch/Start_MYP.bat`, MYP stores user data here:

```txt
DATA/prompts.json
DATA/images/
```

If `DATA/prompts.json` does not exist, the local server creates it automatically with an empty array.

Uploaded images are saved with unique filenames to avoid overwriting files with the same original name. JPG/JPEG/PNG files up to 80 MB are accepted. Existing image paths such as `images/example.jpg` remain readable.

## Backup and migration

To back up or migrate your data, copy the entire `DATA` folder.

To restore data into another MYP copy, replace that copy's `DATA` folder with your backup, then start MYP again.

The source/release package keeps only these placeholder files under `DATA`:

```txt
DATA/.gitkeep
DATA/images/.gitkeep
```

User records and uploaded images are not included in the clean release package.

## Direct `index.html` mode

You can open `index.html` directly in a browser. In that mode, the local service is offline and MYP falls back to browser IndexedDB storage.

Data saved in browser IndexedDB is not included when copying the `DATA` folder.

## Project structure

```txt
MYP/
├─ index.html
├─ assets/
│  ├─ css/style.css
│  ├─ js/app.js
│  ├─ js/canvas-freeze.js
│  └─ icons/favicon.png
├─ docs/screenshot.jpg
├─ Start MYP.exe
├─ MYP.ps1
├─ server/MYP.ps1
├─ launch/
│  ├─ Start_MYP.bat
│  └─ start_silent.vbs
├─ DATA/
│  ├─ .gitkeep
│  └─ images/.gitkeep
├─ README.md
├─ README.zh-CN.md
├─ CHANGELOG.md
├─ LICENSE
└─ .gitignore
```

`RUNTIME/` is intentionally not tracked. It is created automatically while MYP is running.

## Developer notes

The front end is intentionally kept as native HTML/CSS/JS. There is no build step.

The PowerShell server provides:

- `GET /`
- `GET /assets/...`
- `GET /favicon.ico`
- `GET /api/health`
- `GET /api/prompts`
- `POST /api/prompts`
- `POST /api/image`
- `POST /api/delete-image`
- `POST /api/shutdown`
- `GET /data/images/...`

Temporary runtime files live in `RUNTIME/`. User data lives in `DATA/`.

## License

MIT License. See [LICENSE](LICENSE).
