# State map manual

Load this file before judging any artifact as old or new, selecting an update mode, or resolving a shortcut target. All paths are relative to the project root. Never infer one state from another path.

## Runtime provenance gate

Before selecting `renderer-refresh` for a source edit, establish which code the current process actually loads:

- a development renderer must expose a live source/overlay root or development-server origin that maps to the edited file;
- `win-unpacked`, `staging/desktop`, a portable executable, an installer, or `%LOCALAPPDATA%\Programs\DeepSeek Harness` is a packaged runtime and loads its embedded bundle, not `product/app/frontend/source/**`;
- a renderer refresh (`Ctrl+R`, reload, hot reload) only re-reads the current bundle; it never copies, compiles, or injects repository source;
- runtime model/provider data changed through the application or API may use `renderer-refresh` after the data operation, without editing `.dsh` directly.

Provenance evidence must be an inspected runtime URL/path, a process launch target, or an explicit development-runtime marker from the current process. A source path, a shortcut target, an old build message, or model reasoning alone is not evidence. Without provenance, report `runtime provenance not verified` and do not claim a source edit is active.

## State table

| State | Path | Meaning | Refresh/build relation |
| --- | --- | --- | --- |
| `source` | `product/app/frontend/source/**` | editable product renderer injection source | source only; never the running packaged bundle |
| `prepared-source` | `.workspace/artifacts/staging/source/**` | disposable prepared source worktree | input to `product:web:build` and the desktop build |
| `web-build` | `.workspace/artifacts/staging/source/apps/web/dist/**` | WebUI build output | `Ctrl+R` loads it only if the renderer is mapped to it |
| `web-build-result` | `.workspace/artifacts/staging/web-build-result.json` | current WebUI command result | written by `product:web:build`; required evidence |
| `runtime-build` | `.workspace/artifacts/staging/runtime/**` | official runtime plus overlay materialization | input owned by the desktop packager |
| `unpacked-build` | `.workspace/artifacts/staging/desktop/win-unpacked/**` | disposable packaged Electron verification output | `Ctrl+R` reloads this bundle only |
| `unpacked-build-result` | `.workspace/artifacts/staging/desktop/unpacked-build-result.json` | current unpacked command result | written by `product:desktop:unpacked`; required before launch |
| `portable-build-result` | `.workspace/artifacts/staging/desktop/portable-build-result.json` | current portable command result | written by `product:desktop:portable` |
| `installer-build` | `.workspace/artifacts/staging/desktop/installer/**` | disposable NSIS installer | built from the current verified unpacked build |
| `installer-build-result` | `.workspace/artifacts/staging/desktop/installer-build-result.json` | current installer command result | written by `product:desktop:installer`; required before installation |
| `release` | `.workspace/artifacts/releases/v<version>/**` | immutable versioned release output | produced only by the release script |
| `active` | `.workspace/artifacts/active/**` | script-published active release copy | a shortcut may target it only after release verification |
| `installed` | `%LOCALAPPDATA%\Programs\DeepSeek Harness\**` | user-installed application | never direct-edited; updated only through installation |
| `installed-build-result` | `.workspace/artifacts/staging/desktop/installed-build-result.json` | installed target identity and shortcut target | written by `product:desktop:install` |
| `user-data` | `%USERPROFILE%\.dsh\**` | official profile, sessions, settings, persistence | never direct-edited or migrated |

## Shortcut resolution

Resolve the current desktop shortcut target before choosing a mode. A target under `.workspace/artifacts/staging/desktop/win-unpacked/**` is `unpacked-build`; a target under `%LOCALAPPDATA%\Programs\DeepSeek Harness\**` is `installed`; neither target is `source`. A shortcut is only a pointer — inspect its target and verify that target's current artifact identity (result manifest, hash, build time) before citing it as evidence. Never substitute a staging shortcut for an installed artifact.
