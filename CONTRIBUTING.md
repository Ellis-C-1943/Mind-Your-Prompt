# Contributing

MYP intentionally keeps a small dependency-free runtime. Changes should preserve that constraint unless a proposal demonstrates a clear reliability or maintenance gain.

## Required checks

1. Keep visible layout, interactions, and animation endpoints stable unless the change explicitly targets UX.
2. Preserve `DATA/prompts.json`, `DATA/prompts.json.bak`, and `DATA/images/` as the complete portable user-data boundary.
3. Keep application modules and source-line length within the limits enforced by `tools/Test-Project.ps1`.
4. Place state ownership in the module documented by `docs/ARCHITECTURE.md`; do not add late override patches when an existing owner can be edited directly.
5. Do not bypass `saveAll()`, the save queue, revision checks, or transactional deletion for durable prompt changes.
6. Run `tools/Test-Project.ps1 -RunServerSmoke -RunBrowserSmoke` on Windows before submitting a release change.
7. Never commit `DATA/prompts.json`, backups, user images, `RUNTIME`, logs, or temporary files.

Bug-fix comments should explain an invariant or ownership rule, not preserve a chronological repair diary.
