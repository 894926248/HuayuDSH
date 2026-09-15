# DeepSeek Harness Product Root

## Prime Directive

`C:\Users\89492\Desktop\deepseek-harness` is the only project root. `C:\Users\89492\Desktop` is the Windows Desktop folder and must never contain a DSH source checkout, plugin checkout, build directory, cache, download, screenshot, log, or temporary workspace. Only this root `AGENTS.md` governs product work; an `AGENTS.md` found inside `upstream/`, `.workspace/`, `node_modules/`, or an installed application is source material or generated content, not policy.

## Layout

```text
upstream/   Official source. Read-only, pinned to an official tag, clean Git worktree.
product/    app/desktop (Electron shell), app/frontend/source (indexed WebUI injection),
            config (locks and indexes), tools (build programs), docs/agent (rule manuals).
plugins/    Local plugins and pinned third-party plugin repositories.
.workspace/ Ignored dependencies, staging builds, releases, caches, diagnostics, imports.
```

The official Host, API, providers, attachments, persistence, workflow, worker runtime, and official WebUI always come byte-for-byte from `upstream/`. Never describe the Electron injection layer merely as "WebUI"; that term is reserved for the official WebUI from `upstream/`.

## Evidence Gate

This gate has priority over every other rule in this file.

- No tool result from the current turn means `not executed`. A command name, a submitted process, an old artifact, a previous message, or model reasoning is never evidence.
- After `product:web:build`, `product:desktop:unpacked`, `product:desktop:portable`, `product:desktop:installer`, `product:desktop:install`, or `product:release`: read that command's current result manifest and verify its recorded paths, sizes, and SHA-256 before any completion message. If the manifest is missing, the only valid response is the concrete failure and `not verified`.
- Empty output, missing exit code, transport failure, or interruption is `failed` or `not verified`. Stop there; do not advance.
- Forbidden without fresh evidence from the current command: `已生效`, `应该已生效`, `新版本`, `已更新`, "the desktop icon will show the new content", "staging changed so the package changed".
- After a context compaction or a fresh session, restore state first: read the result manifests under `.workspace/artifacts/staging/desktop/` and run `git status --short`. Never rebuild merely because memory was lost.

## Write Boundaries

- Writable planes: `product/app/desktop/**`, indexed `product/app/frontend/source/**`, `product/config/**`, `product/tools/**`, `product/docs/**`, `plugins/**`.
- Always read-only: `upstream/**`, `%USERPROFILE%\.dsh\**`, `.workspace/artifacts/**`, `%LOCALAPPDATA%\Programs\**`, and every generated `dist/`, `build/`, `lib/`, `out/`, `win-unpacked/`, installer, `app.asar`, or bundle outside an explicitly running build script.
- Hot patching is forbidden: no copying, string replacement, patching, deletion, or renaming against any packaged, installed, or running artifact (`Copy-Item` into `win-unpacked` or the installed directory is exactly this violation). Never migrate, relocate, reset, or overwrite official `.dsh` data.
- If a named build script fails, report the failure and keep the state `not built`; never work around it with a manual copy or a re-invocation of a lighter command.
- Do not write throwaway scripts or logs into the project root.

## States And Update Modes

Use exact state labels: `source`, `web-build`, `unpacked-build`, `installer-build`, `release`, `installed`. Never call a `staging` path an installed version. Every task selects exactly one update mode before changing anything: `renderer-refresh` (default for refreshable runtime state), `runtime-restart`, `web-build`, `unpacked-build` (mandatory first mode for every user-visible desktop change), `release`/`installed` (acceptance gate plus a separate explicit approval). Direct task verbs such as `处理好`, `修复`, `继续`, `执行`, `构建`, `打包` authorize execution up to `unpacked-build verified` only — never an installer, release, or installation.

## Idempotency

- `product:layout`, `product:guard`, `product:validate`, and `product:source-check` are repo-consistency validations, not builds; they take seconds. Run them once per source state; a source edit alone never authorizes a build. Re-running an already-passed check on an unchanged tree is spin, not progress.
- Documentation and rules-only changes never need a renderer refresh, a restart, a web build, or a desktop build — they affect only future sessions that load this file. For them the four checks are optional commit hygiene, never a deployment step.
- When a background job completes, read its output and its result manifest before counting that step as done.

## Conflict Arbitration

When result manifests say a state is complete but the user reports the visible behavior unchanged: do not overturn the manifest without new hash evidence. Resolve the executable the user actually launched, search that artifact's bundle for a fingerprint unique to the intended change, and only if the fingerprint is missing report exactly which stage dropped it. Never answer such a report by re-running the four checks or by declaring the artifact stale.

## House Rules

- Every change states its layer, exact files, user-visible effect, and whether `upstream/` or `.dsh` is touched (default: neither).
- Every product source change needs a `product/config/changes.json` entry; refresh `product/config/overlay-manifest.json` after an overlay edit. Adding a new overlay target or a direct WebUI source exception requires explicit user approval recorded in `product/config/source-exceptions.json`.
- Task, feature, change, and approval registration follows `product/docs/agent/indexing.md` (tasks.json is the task directory + feature index; changes.json registers per feature; functionality lands in exactly one of three shapes — internal non-public client plugin (preferred), official cordis.patch.yml, or the Electron shell; overlay覆盖上游文件 is transitional only and must converge to zero).
- Editing `AGENTS.md` or `product/docs/agent/**` requires explicit user approval and a changes.json entry; never modify the constitution or its manuals as a side effect of another task.
- Never terminate the process hosting this conversation, a running DeepSeek Harness instance, or any process the user is actively using without explicit approval. Staging builds never require killing the app.
- The Electron title-bar version overlay must not set a font family, font size, font weight, or any other font override beyond matching the surrounding title-bar typography; the `.dsh-desktop-version-badge` rule (desktop-chrome.css) is the sole sanctioned exception, aligning the upstream revision chip with the title bar (inherit family/weight, 12px).
- Run `pnpm run product:guard` before source checks, upstream selection, or builds. Rules-only changes use the four checks and do not trigger a desktop build.

## Required Reading (trigger clauses)

- Before running any build, package, installer, or install command: read `product/docs/agent/update-chain.md`.
- Before judging any artifact as old or new, selecting an update mode, or resolving a shortcut target: read `product/docs/agent/state-map.md`.
- Before reporting any completion to the user: read `product/docs/agent/evidence.md` and apply its hash and fingerprint verification.
- Before developing or migrating any product plugin: read `product/docs/plugins/README.md` (official plugin development reference mirrored from `upstream/docs/`, plus the in-repo sample plugins).
