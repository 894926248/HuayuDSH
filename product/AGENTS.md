# Product layer instructions

The repository root is `C:\Users\89492\Desktop\deepseek-harness`. `C:\Users\89492\Desktop` is only the Windows Desktop folder and must not receive project files.

Keep tracked product work in one of these directories:

- `app/desktop/`: Electron main process, preload bridge, native integration, stable icon, and portable packaging.
- `app/frontend/source/`: the indexed browser UI overlay only.
- `config/`: product version, overlay hashes, retention, and the change index.
- `docs/`: agent rule manuals loaded through the root AGENTS.md trigger clauses.
- `tools/`: build and verification programs.

The official Host, API, providers, attachments, model handling, persistence, profile composition, workflow, and wire behavior always come from `upstream/`. The upstream checkout is read-only: do not edit, patch, or commit its files. Do not add a product backend, shared runtime replacement, or backend overlay. Product functionality and the official runtime must ship as one Electron application.

The default product customization mechanism is the WebUI overlay. The overlay is applied only to a disposable build worktree and is never written back to `upstream/`. When an upstream tag changes, `product:frontend-sync` performs a three-way merge: clean upstream changes are accepted, and conflicting hunks retain the product version and are reported in the overlay manifest. A direct source exception is allowed only for a WebUI target that cannot be handled by shell injection or a plugin, and only after explicit user approval is recorded in `config/source-exceptions.json`.

`.workspace/` is an ignored work area for dependencies, staging, releases, caches, diagnostics, and historical imports. Never cite it as source, index it as a product change, or copy it into a release lock.

The upstream version source is `upstream/package.json` plus the upstream Git tag. Use `pnpm run product:upstream:list` to inspect cached releases, `pnpm run product:upstream:fetch` to download new official tags, and `pnpm run product:upstream:select -- dsh-vX.Y.Z` for either a switch or rollback. The selected submodule commit is recorded by the root repository's gitlink.

Every product source change must have a corresponding `config/changes.json` entry. Refresh `config/overlay-manifest.json` with `pnpm run product:frontend-sync` after editing an overlay file. `pnpm run product:guard` is the source gate; it must pass before changing upstream versions or packaging. `pnpm run product:layout`, `pnpm run product:versions`, `pnpm run product:validate`, and `pnpm run product:source-check` are required before packaging.
