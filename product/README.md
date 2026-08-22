# DeepSeek Harness product layer

The repository has two source planes. `upstream/` is a clean Git worktree pinned to the selected upstream commit. `product/current/` is the product source plane shipped by the Electron executable. The source plane is applied to a temporary upstream worktree during a build; the pinned `upstream/` checkout is never modified.

The product overlay is divided by runtime ownership:

```text
product/current/
  frontend/  Browser-side product UI source and ownership map
  backend/   Backend ownership policy only; product source is forbidden
  desktop/   Electron main/preload code and native integrations
  shared/    Official wire-contract policy only
  overlay-manifest.json  Indexed product file paths and SHA-256 values
```

Supporting files live beside the overlay:

```text
product/
  checks/    Source and artifact verification
  index/     Product change registry and queries
  manifests/ Build inputs, upstream commit, and output hashes
  migration/ Relocation records for code still in legacy locations
  artifacts/ staging, active release, retained releases, and build cache
```

Do not copy the full upstream repository into `product/current/`. The product version is one portable Electron application containing the official upstream Host/Backend runtime, the indexed frontend UI files, and the Electron shell. The build copies frontend files into a disposable source worktree and verifies every SHA-256 before compilation. The official backend checkout is never overlaid by product code.

The backend is upstream-only by policy: no product RPC, attachment, quota, model, provider, or persistence source may be copied into the Host tree. The Electron shell mounts that official runtime in its main process, so the released EXE is a single application rather than a user-managed shell plus Host pair. UI changes use the client extension surface where available; unavoidable UI composition files are owned under `product/current/frontend/source` and are never edited in `upstream/`. Electron-only behavior stays in the shell and crosses into the renderer through a typed preload bridge.

The source-plane checks are:

```powershell
node product/checks/verify-upstream-clean.mjs
node product/checks/verify-product-source.mjs
```

The first check proves that the pinned upstream worktree is clean. The second proves that the locked commit and every indexed frontend file match before a build. The temporary source worktree is created under `product/artifacts/staging/source`, then removed after packaging.

`pnpm run product:frontend-sync` only recalculates the UI overlay hashes. It never copies files from the legacy migration checkout. `pnpm run product:frontend-import-legacy` is the one explicit migration command that imports the original 14 UI files, and must not be used after the product frontend becomes the maintained source of record.

## Repository model

The long-term product repository should be a separate sibling or remote repository, not a nested `.git` directory inside this checkout. It stores the product overlay, Electron shell, source-layer index, build tools, and release records. The upstream repository remains a remote and is fetched at the commit named by each release lock; a clean worktree is materialized only for the active build. The current checkout remains the migration workspace until the product files have moved out of official paths.

## Build and retention

All product artifacts use `product/artifacts/`. `staging/` holds one replaceable build, `active/` holds the files used by the repaired shortcut, `releases/<version>/` holds retained release files and its `release-lock.json`, and `cache/` holds disposable keyed build inputs. The default retention policy keeps three successful releases and three cache entries.

The release builder clears upstream generated output before the full Host, Client, and Web build. This prevents ignored `lib/` files or TypeScript build metadata from being reused across releases and makes the packaged runtime depend only on the pinned upstream commit and product overlay. The staged runtime records the official commit and CLI version; a release cannot be produced from a lock mismatch or a dirty official worktree.

Release preparation is Git-bound:

```powershell
node product/checks/validate-product-index.mjs
node product/checks/verify-product-source.mjs
node product/build/build-desktop-release.mjs
node product/checks/release-lock.mjs verify --manifest product/artifacts/active/release-lock.json
node product/checks/retain-artifacts.mjs prune
```

The release builder rejects dirty Git state, an unclean pinned upstream worktree, an unregistered product path, and a missing version manifest. A dirty development build may use staging directly, but it does not produce a valid release lock.
