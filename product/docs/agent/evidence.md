# Evidence manual

Load this file before reporting any completion to the user.

## Forbidden claims without fresh evidence

`已生效`, `应该已生效`, `新版本`, `已更新`, `已改`, `已同步`, `已校验`, `已启动`, `已完成`, "the desktop icon will show the new content", "staging/source changed so `win-unpacked` changed". A matching filename, an old timestamp, a shortcut target, an earlier "build succeeded" message, or model reasoning is not evidence.

## Evidence must match the change

- An executable SHA-256 proves nothing about a WebUI overlay change: the web bundle ships as extraResources, and the exe hash can stay identical while web content changes. Verify the exe hash only for desktop main-process changes.
- For a WebUI change, verify inside the built bundle (web-build, runtime-build, or unpacked-build): search the dist assets for a fingerprint unique to this edit — a class name, option value, or literal string that only this change introduces. Only a found fingerprint proves the change reached the artifact.
- For a desktop main-process change, verify the built `lib/bundle` output inside `unpacked-build`.
- The result manifest is the completion record. Verify its recorded path, byte count, SHA-256, and `completedAtUtc` from the current command only.

## Minimum verification sequences

Renderer refresh: (1) confirm the current renderer is the runtime that loads the requested source or runtime state; (2) trigger the normal refresh path; (3) inspect the requested behavior in that same process; (4) report `renderer-refresh verified` — never a build, package, release, or installed update.

Packaged UI: (1) select the correct state (refresh, web-build, unpacked-build, release, installed; for a desktop change select `unpacked-build` first); (2) run the named command for that state and wait for its completed result; (3) confirm exit success, the exact output path, and the changed source/output hash or marker; (4) launch the exact artifact by absolute path and verify the visible behavior in that process; (5) only then report `unpacked-build verified` — and only after the later explicit approval, a fresh installer/release command, its manifest verification, and the installed target verification may the result be called `installed` or `release`. If any check is missing or stale, report `not verified` and stop rather than guessing or sending the user to an old shortcut.

## Command output integrity

Run commands with inherited stdout, stderr, and exit code. Do not use `2>&1 | Write-Host`, `Out-Null`, `Format-*`, `Select-Object`, or any wrapper that hides output or replaces the process exit code. An empty tool result, a missing exit code, a transport error, or an interrupted stream is not a successful command; keep the state `not executed`, `failed`, or `not verified`. A PowerShell wrapper must return the child status explicitly:

```powershell
pnpm run product:desktop:unpacked
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

## Conflict arbitration procedure

When result manifests say a state is complete but the user reports the visible behavior unchanged:

1. Do not overturn the manifest conclusion without new hash evidence; do not re-run the four checks as an answer.
2. Resolve the executable the user actually launched: shortcut target, running process path, or the exact path the user opened.
3. Search that artifact's bundle for the fingerprint of the intended change (see "Evidence must match the change").
4. Only if the fingerprint is missing, identify which stage dropped the change (web-build content, runtime materialization, install target, or the user looking at a different artifact) and report that finding.
5. Never declare an artifact stale without a hash or fingerprint comparison from the current turn.
