# Security Policy

## Scope

MYP is a single-user local application. Its PowerShell service listens only on `127.0.0.1`; it is not intended to be exposed to a LAN, the internet, a port-forward, or a reverse proxy.

## Implemented controls

- The listener binds only to `127.0.0.1` on ports `47350–47370`.
- Every mutation endpoint requires a random per-launch `X-MYP-Session` token.
- Browser requests are checked for same-origin metadata, and mutation bodies must use `application/json`.
- No CORS permission is emitted. The application page receives CSP, frame denial, MIME-sniffing protection, referrer restriction, and same-origin resource policy headers.
- Prompt request bodies are bounded and must contain a JSON array.
- Prompt reads return a SHA-256 content revision. Stale writes receive HTTP 409 instead of silently overwriting newer data.
- Prompt saves use a same-directory temporary file, prefer `File.Replace`, and retain the previous valid database as `prompts.json.bak`.
- When atomic replacement is unavailable, saving falls back to a compatible backup-then-overwrite path rather than failing silently.
- Prompt updates and permanent image deletions use one reversible transaction. Images are moved under `RUNTIME/transactions` before the database commit and restored if the commit fails; uncommitted transaction directories are recovered on the next launch.
- Invalid primary databases are left untouched; a valid backup may be served, and the damaged primary is preserved on the next successful save.
- Legacy UTF-8 BOM databases are accepted without rewriting them during read.
- Image uploads are limited to 80 MB, restricted to JPG/JPEG/PNG, and checked against their binary signatures.
- Static and image paths are canonicalized and constrained to approved project roots.

## Trust boundaries

The session token and origin checks protect the local HTTP API from unrelated browser pages. They are not an operating-system sandbox: a process running as the same Windows user can already read or modify files in the project directory. The Windows account and filesystem permissions remain the final local trust boundary.

A crash in the narrow interval after the database commit and before the transaction commit marker may restore a no-longer-referenced image on the next launch. This produces a safe orphan file rather than a missing image referenced by the database; it does not move user data outside `DATA` permanently.

`Start MYP.exe` is unsigned. Its complete source and build script are included. Environments that forbid unsigned executables should use `launch/Start_MYP.bat` or start `server/MYP.ps1` manually.

## Reporting

Do not include real prompts, private images, or a populated `DATA` directory in a public issue. Provide the MYP version, Windows version, browser, reproduction steps, and sanitized logs from `RUNTIME/server.log`.
