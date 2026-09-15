# DeepSeek Harness product layer

`product/` contains all tracked DeepSeek Harness product work. It has four directories only:

```text
product/
  app/     Electron shell and indexed frontend overlay
  config/  Product version, upstream lock, overlay hashes, retention, and change index
  docs/    Agent rule manuals loaded through the root AGENTS.md trigger clauses
  tools/   Build, validation, source-preparation, and release scripts
```

`upstream/` is the clean official function layer. It supplies Host, API, provider, attachment, model, persistence, workflow, and wire behavior. Product code never overlays those paths. The Electron shell embeds that official runtime into one portable application; it is not a separately operated backend.

`.workspace/` is ignored runtime state. It holds dependencies, staging builds, retained releases, caches, diagnostics, and one-time imports. Nothing under it is source or a Git release input.

The application overlay contains only WebUI presentation files under `app/frontend/source/`. `config/overlay-manifest.json` records every overlay path and SHA-256. `app/desktop/` owns only the outer Electron shell, preload bridge, native menus, notification behavior, icons, shortcuts, and packaging; it does not replace the Host or API. There is no product backend directory because the backend must remain upstream-only.

`config/source-policy.json` is the enforceable boundary. `pnpm run product:guard` rejects a dirty official checkout, a backend/shared overlay, an unindexed WebUI source plane, or an unapproved direct-source exception. The exception registry is intentionally empty until the user approves a specific WebUI change that injection and plugins cannot implement.

The official version pin lives in the `upstream` Git submodule itself: its own `package.json`, tags, commits, and Git object database are the source of truth. The product Git tree records the selected submodule commit as a gitlink. A generated release lock repeats the upstream version, tag, and commit only as artifact provenance.

The `upstream` checkout contains one working version at a time. Fetching a newer release stores its objects and tag locally; selecting an older tag is an offline checkout, not a second download:

```powershell
pnpm run product:upstream:list
pnpm run product:upstream:fetch
pnpm run product:upstream:select -- dsh-v0.1.1-rc.2
pnpm run product:upstream:rollback -- dsh-v0.1.1-rc.1
```

After a selection, run `pnpm run product:frontend-sync` and the product checks before recording the root Git commit. The sync compares the old upstream commit, the product overlay, and the new official commit; it never silently replaces product code on a conflict. Each root Git commit therefore points to one exact upstream Git commit and one exact product overlay.

Run these checks after a product change:

```powershell
pnpm run product:layout
pnpm run product:guard
pnpm run product:versions
pnpm run product:validate
pnpm run product:source-check
pnpm run product:upstream
pnpm run desktop:build
```

`pnpm run product:build` creates a portable release in `.workspace/artifacts/`. It rejects a dirty product tree, a dirty official source submodule, a version/tag/commit mismatch, unknown product source, or an overlay hash mismatch. The retention policy in `config/retention.json` keeps three successful release directories and three caches.
