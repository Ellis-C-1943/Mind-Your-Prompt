# MYP Architecture

## Runtime model

MYP has two storage modes behind one UI:

1. **Local service mode** — `server/MYP.ps1` serves static files and stores prompts/images in `DATA`.
2. **Browser fallback mode** — `assets/js/storage.js` stores prompts/images in IndexedDB when the initial local-service connection cannot be established.

The fallback decision is made only during the initial prompt load. Once a server connection is confirmed, later server errors are surfaced instead of silently switching to a different storage backend.

## JavaScript ownership

| Module | Owns |
|---|---|
| `core.js` | shared application state, editor sizing, hero-title layout |
| `prompt-model.js` | prompt shape helpers, ordering, model normalization, current/draft lookup |
| `persistence.js` | server session, API boundary, revisions, save serialization, IndexedDB routing |
| `project-list.js` | left list rendering, active frame, order editing, long-press drag sorting |
| `stage-layout.js` | grid geometry, transition ghosts, text measurement, transition cleanup |
| `stage-transition.js` | single/grid transition state machine and phase sequencing |
| `stage-grid.js` | grid rendering, thumbnail upgrades, grid selection and drag sorting |
| `editor.js` | form rendering, render-version guards, save/delete/upload operations, lightbox and media layout |
| `preferences.js` | overlay scrollbars, theme, accent color, language application |
| `bootstrap.js` | DOM event bindings, startup migration/load, connection status, tab lifecycle |

Shared state is declared once in `core.js`. Persistence code must enter through `saveAll()` or `api()`. Transition-owned temporary DOM and inline styles must be removed by `cleanupStageModeTransition()`.

## Stage transition contract

The stage keeps four independent visual owners:

- the real hero image;
- the real grid;
- temporary image/text ghosts used only during mode transitions;
- the persistent bottom shade.

A mode switch follows this sequence:

1. measure the current real nodes;
2. create transition ghosts;
3. lock real-node visibility;
4. animate geometry and text in parallel;
5. hand the final geometry back to real nodes;
6. run one cleanup path.

No feature outside the stage modules should mutate transition classes or ghost nodes. The browser regression suite verifies rapid repeated mode input returns to an unlocked stable state.

## Render contract

`renderForm()` increments a render version before asynchronous image resolution begins. Every asynchronous continuation checks that version before mutating shared DOM. A slow render started for an old project therefore cannot overwrite a newly selected project.

Persistence completion and repaint completion are separate boundaries. After a save succeeds, a later render error may be reported, but it must not roll back the durable prompt snapshot, delete committed images, or restore an old ordering.

## CSS load order

CSS modules are loaded in explicit cascade order:

1. `tokens.css`
2. `sidebar.css`
3. `stage-base.css`
4. `editor.css`
5. `preferences.css`
6. `stage.css`
7. `scrollbars.css`
8. `project-list.css`

New declarations belong in the file that owns the component. Avoid creating a second “final override” section at the end of another stylesheet.

The complete stylesheet tree contains one `!important` declaration. It is limited to the single-mode grid-selection-frame visibility guard, where it must outrank a temporary inline transition style. Validation fails if any other stylesheet begins depending on `!important`.

## Persistence contract

### Frontend

- Every save captures an immutable complete prompt-array snapshot.
- Saves enter one promise queue and reach storage strictly in enqueue order.
- A rejected save does not poison the queue; the next explicit save may proceed.
- `savedPrompts` advances only after a snapshot is durably accepted.
- Local-service mutations include the per-launch session token and latest known content revision.

### Local service

- Prompt reads return a SHA-256 content revision.
- A stale expected revision receives HTTP 409.
- The new prompt snapshot is validated and flushed to a same-directory temporary file.
- `File.Replace` atomically swaps it into place and keeps the previous snapshot as `.bak` when supported.
- Image deletions are first moved into a transaction directory, then the prompt snapshot is committed.
- A failed commit restores moved images. Startup restores images from any uncommitted transaction directory left by an interrupted process.

### IndexedDB fallback

`assets/js/storage.js` commits the prompt snapshot and requested image deletions in one IndexedDB transaction across the prompt and image stores.

## Data portability contract

The portable user-data boundary remains unchanged:

```text
DATA/
├─ prompts.json
├─ prompts.json.bak
└─ images/
```

Copying the complete `DATA` directory remains sufficient for backup, migration, and restoration. `RUNTIME` contains only logs, port state, and temporary recovery material; it is not part of the durable user-data format.

## Test contract

- `tools/Test-Project.ps1` checks required files, script order, syntax, module size, line length, CSS override budget, data cleanliness, and reliability controls.
- `tools/Test-Server.ps1` starts the real Windows PowerShell server and covers authorization, revisions, legacy data, backups, corruption recovery, image validation, transaction commit, and rollback.
- `tools/Test-Browser.mjs` runs the real frontend in headless Chrome/Edge/Chromium and covers stale renders, save serialization, failed-save recovery, transactional deletion, post-save repaint failures, and rapid mode switching.

## Release contract

`tools/Build-Release.ps1` rebuilds the launcher, runs static/server/browser checks, excludes all user/runtime data, and writes SHA-256 hashes for the packaged files.
