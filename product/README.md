# DeepSeek Harness product layer

The repository has two source planes. `upstream/` is a clean Git worktree pinned to the selected upstream commit. `product/current/` is the product overlay shipped by the Electron executable. The overlay is compiled against the upstream plane and is loaded through Cordis patch layers and the desktop bridge.

The product overlay is divided by runtime ownership:

```text
product/current/
  frontend/  Browser client plugins, React views, and CSS
  backend/   Host Cordis plugins, RPC, and persistence adapters
  desktop/   Electron main/preload code and native integrations
  shared/    Cross-face types and wire contracts
  patch/     Product-only cordis.patch.yml files
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

Do not copy the full upstream repository into `product/current/`. The product version is the composition of `upstream/` plus this overlay. This keeps one official source of truth and makes an upstream update a reference change followed by a compatibility build.

Client plugins use the official `dsh.client` and Slot APIs. Host plugins enter through Cordis patch rows. Electron-only behavior stays in the shell and crosses into the renderer through a typed preload bridge. DOM scanning, private React imports, and broad CSS selectors are not product extension mechanisms.

The source-plane check is:

```powershell
node product/checks/verify-upstream-clean.mjs
```

The check reports two independent conditions: whether the active commit matches `upstream/`, and whether the working tree changes official paths outside the product allowlist. A failing result is expected while the legacy branch or legacy product changes remain; the relocation targets are listed in [migration/source-map.md](migration/source-map.md).

## Repository model

The long-term product repository should be a separate sibling or remote repository, not a nested `.git` directory inside this checkout. It stores the product overlay, Electron shell, patch layers, index, build tools, and release records. The upstream repository remains a remote and is fetched at the commit named by each release lock; a clean worktree is materialized only for the active build. The current checkout remains the migration workspace until the product files have moved out of official paths.

## Build and retention

All product artifacts use `product/artifacts/`. `staging/` holds one replaceable build, `active/` holds the files used by the repaired shortcut, `releases/<version>/` holds retained release files and its `release-lock.json`, and `cache/` holds disposable keyed build inputs. The default retention policy keeps three successful releases and three cache entries.

Release preparation is Git-bound:

```powershell
node product/checks/validate-product-index.mjs
node product/build/build-desktop-release.mjs
node product/checks/release-lock.mjs verify --manifest product/artifacts/active/release-lock.json
node product/checks/retain-artifacts.mjs prune
```

The release builder rejects dirty Git state, an unclean pinned upstream worktree, an unregistered product path, and a missing version manifest. A dirty development build may use staging directly, but it does not produce a valid release lock.
