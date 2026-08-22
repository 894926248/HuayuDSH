# Product layer instructions

`product/` contains DeepSeek Harness product code that is layered over the upstream Harness source. Product behavior lives in the Electron shell or source files owned by the frontend, backend, shared, and tooling layers. A release build injects those files only into a disposable source worktree and never edits `upstream/`.

## Directory ownership

- `current/frontend/` contains browser UI ownership records and the only permitted source overlay.
- `current/backend/` contains backend ownership records only; source overlays are forbidden.
- `current/desktop/` contains Electron main, preload, native menus, notifications, and packaging glue.
- `current/shared/` documents official wire ownership; source overlays are forbidden.
- `current/overlay-manifest.json` is the file-level source index and hash record.
- `checks/` contains source-plane and artifact-plane verification scripts.
- `manifests/` contains build inputs and output hashes.
- `index/` contains the hand-edited product change registry and its query tools.
- `migration/` records the source-to-product relocation map.

Keep browser and Electron code in their owning directory. Host, API, provider, attachment, quota, model, persistence, and wire-contract code is always supplied by `upstream/`. The desktop package embeds and mounts that official runtime in the Electron main process; it is one application at delivery time, not a separately operated backend. A product UI feature may consume official client contracts, but it must not add a product-owned backend companion.

The current `apps/desktop/` and `plugins/` trees in the legacy checkout are migration inputs only. Do not add new product files to those temporary locations. Do not add new source patches; add the real product file under its owning layer and update the overlay manifest.

`index/registry.json` is the only editable change index. Generated release locks, hashes, staging files, caches, and active copies belong under the ignored `product/artifacts/` tree. Release commands must reject a dirty product or upstream worktree; local experiments use a non-release staging command and never become release records. `product/manifests/upstream-lock.json` is the source of record for the official functionality layer and must be updated before a newer upstream commit can enter a build.
