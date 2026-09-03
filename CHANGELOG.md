# Changelog

## 1.5.0 — 2026-07-12

- Fixed rapid double-click project selection leaving a stale long-press timer that could create a detached drag ghost in the upper-left corner and hide the selected-project glow.
- Added a browser regression covering project-list DOM replacement between pointer-down and pointer-up.
- Unified the release version, launcher source, launcher metadata, and package naming under 1.5.0.

## 0.2.0-r3.1 — 2026-07-11

- Fixed the single-to-grid transition so the moving full-resolution preview remains sharp while shrinking into its grid card; only the stationary grid backdrop receives the intended blur.
- Added a browser regression that samples the transition image at the start and mid-animation and rejects any reintroduced blur.

## 0.2.0-r3 — 2026-07-11

- Preserved the existing launcher paths, `DATA` folder format, interface, interaction flow, and animation timing.
- Added a random per-launch API session token, same-origin mutation checks, JSON content-type enforcement, CSP, and related browser security headers.
- Added serialized frontend saves and SHA-256 revision checks so concurrent or stale writes cannot silently reorder durable state.
- Added reversible prompt/image transactions, nested-path recovery, startup recovery for interrupted deletions, and server-side refusal to delete still-referenced images.
- Added render-version guards so slow image work from a previously selected project cannot overwrite the current editor.
- Separated persistence commit boundaries from UI repaint boundaries, preventing a repaint failure from deleting successfully committed images or rolling back durable order changes.
- Added rollback for failed list and grid reordering saves.
- Reduced CSS `!important` usage from 139 declarations to one verified transition/selection guard while retaining pixel-identical stable states and matching transition/drag computed styles.
- Split prompt-model responsibilities out of the core module, consistently formatted JavaScript, and added browser regressions for stale renders, rapid mode switching, serialized saves, failed-save recovery, transactional deletion, and post-save repaint failures.

## 0.2.0-r2 — 2026-07-11

- Restored direct compatibility with existing `DATA/prompts.json` files and the original local API behavior.
- Removed the session-token gate that could reject prompt reads and saves in real browser launches.
- Added UTF-8 BOM compatibility and retained support for legacy records without grid-order fields.
- Kept atomic saves where supported and added a reliable backup-then-overwrite fallback.
- Changed corruption handling so the original database is never deleted automatically.
- Added visible save-failure feedback instead of failing only in the browser console.
- Kept the interface, interaction flow, layout, and animation timing unchanged.

## 0.2.0 — 2026-07-11

- Split the frontend monoliths into responsibility-based JavaScript and CSS modules without changing the interface, interactions, animation timing, or layout.
- Replaced the large stage-mode switch routine with explicit transition phases and shared cleanup contracts.
- Removed unreachable functions, selectors, hidden layers, and overridden declarations.
- Added bounded request bodies, image-signature validation, backups, static validation, release checksums, and architecture documentation.

## 0.1.0 — 2026-07-10

- Initial public beta with local prompt and image storage, single/grid preview modes, drag sorting, themes, accent colors, language switching, lightbox preview, and IndexedDB fallback.
