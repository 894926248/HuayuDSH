# Update chain manual

Load this file before running any build, package, installer, or install command.

## Update modes

1. `renderer-refresh` — default for runtime state and API data already loaded by the current renderer. Refresh or hot-reload the renderer and inspect the visible result. A source-file edit qualifies only after the provenance gate (`state-map.md`) proves that this renderer loads that source or a live overlay.
2. `runtime-restart` — when the renderer reads changed runtime configuration or plugin state only at startup. Restart through the normal UI or command; never edit `%USERPROFILE%\.dsh` directly.
3. `web-build` — only when the requested result needs a new WebUI artifact or the active renderer does not load the edited source. Run `product:source-prepare` first, then `product:web:build`. This is still not a desktop package.
4. `unpacked-build` — the mandatory first desktop mode for every user-visible desktop change. Run `product:desktop:unpacked`, read `unpacked-build-result.json`, launch the exact reported executable, verify the requested behavior, stop at `unpacked-build verified`.
5. `release` / `installed` — only after the acceptance gate passes and the user sends a separate explicit approval naming the formal action (for example `同意生成并安装正式包`).

## Required chain

`product/**` or `plugins/**` source → source preparation → focused build → `unpacked-build` → launch the exact temporary artifact → visible verification → explicit user acceptance → installer build → installer verification → NSIS installation → installed-package verification.

Stage outputs are consumed only by the named script that owns the next stage:

- `product:web:build` requires `product:source-prepare` first and owns `web-build` only; it never proves that a desktop package changed.
- `product:desktop:unpacked` owns `unpacked-build` and is the sole supported way to materialize the desktop verification package.
- `product:desktop:portable` is the portable distribution mode and owns its result manifest.
- `product:desktop:installer` owns the NSIS installer and requires the verified unpacked build.
- `product:desktop:install` invokes the verified installer, then verifies the actual installed directory and shortcut. `--reuse-installer` is permitted only when the current `installer-build-result.json` path, size, and SHA-256 match; `--verify-only` verifies without installing.
- `product:release` is the immutable release mode and requires clean product and upstream worktrees.
- Build scripts may replace their own disposable staging output; they must never mutate an existing release, an installed package, a running process, or user data.

A successful source or WebUI build never authorizes copying its files into `win-unpacked`, `app.asar`, `%LOCALAPPDATA%`, or a running process. If the installed package is stale, first run and verify `product:desktop:unpacked`, then obtain the user's separate installation approval; never point the user at `win-unpacked` as if it were installed.

## Acceptance gate (mandatory before installer, release, or installation)

1. Read `unpacked-build-result.json` from the current command and verify every recorded path, byte count, and SHA-256.
2. Launch the exact absolute `win-unpacked` executable named by that manifest — not the desktop shortcut, not an older executable.
3. Inspect the requested behavior in that temporary process and report the state as `unpacked-build` with its exact path.
4. Stop and ask for the separate explicit approval. A previous approval, a direct task verb, an old approval, or the existence of an installer manifest does not satisfy this gate. After an interrupted or failed installer stage, preserve `failed` / `not verified` and do not retry installation unless the user explicitly approves the retry.

## Command discipline

- Run build and verification commands with original stdout, stderr, and exit code preserved. Do not wrap them in anything that hides output or replaces the process exit code. A PowerShell wrapper must return the child status explicitly (see `evidence.md`).
- Do not run a desktop or release build for a renderer-only refresh when the active development runtime can reload the UI.
- Do not poll, sleep, watch, or repeatedly inspect a submitted command merely to observe progress. Treat a completed command as complete; launch an artifact only after its build command has finished.
- When the user approves a specific proposed command, execute it immediately and report its real result; do not ask for the same approval again and do not substitute a shortcut or an older artifact.
