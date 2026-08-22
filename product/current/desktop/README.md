# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

Electron desktop shell for the DeepSeek Harness Web application. The shell owns the native window, single-instance activation, the embedded Web profile, and the isolated preload bridge; the renderer reuses [`apps/web`](../web/README.md).

## Commands

From the repository root, build the Web and host artifacts first, then use:

```sh
pnpm run desktop:dev
pnpm run desktop:package
pnpm run desktop:dist
```

`desktop:package` creates an unpacked application directory under `product/artifacts/staging/desktop`. `desktop:dist` creates the fixed-name Windows portable executable in the same staging directory. A release build must use `node product/build/build-desktop-release.mjs`, which records the result under `product/artifacts/releases/<version>/` and copies the active executable to `product/artifacts/active/`.

The portable target stores the Electron runtime without archive compression so rebuilding the shell stays fast; the resulting executable is larger by design.

The fixed release file is `DeepSeek Harness.exe`. The portable launcher may run its extracted copy from `%TEMP%`; that path is an implementation detail and must not be used by a shortcut. Use `pnpm --filter @deepseek-ai/dsh-desktop run repair-shortcut` after a successful product release to target `product/artifacts/active/DeepSeek Harness.exe`; pass additional existing `.lnk` paths when repairing taskbar pins. The script writes the stable target, icon, and `System.AppUserModel.ID` (`ai.deepseek.harness`) so the pinned shortcut and the running window stay in one taskbar group.

The native taskbar and window icon use paired light/dark rasterizations of the canonical Web `apps/web/public/favicon.svg`, selected from the renderer's resolved theme. The portable executable and shortcut keep the stable `build/icon.ico` identity derived from the same DSH asset, so theme changes do not alter the executable or shortcut target. The package contains the Electron shell and a pnpm-deployed production closure of the pinned upstream `@deepseek-ai/dsh` package, including its built frontend, backend, config, plugins, workers, and native runtime dependencies. Workspace links are materialized before electron-builder copies the payload. Verification boots the packaged `lib/bin.js` and resolves every standard preset entry from the unpacked resources with a temporary `DSH_HOME`.

When a non-current session completes, the common Web session list projects that state to the desktop shell. Windows flashes the fixed app taskbar button and shows a small red overlay marker; the marker clears when the window receives focus or the completed session reminder is consumed. This is shell-owned OS presentation, so plugin entries do not need taskbar code or changes.

The desktop shell imports the deployed `lib/bin.js` entry from its embedded upstream closure, boots the Web profile in the Electron main process, disables the profile's default-browser handoff, asks the OS for an available loopback port, and loads that URL in the renderer. It never automatically attaches to a different process already using that port. The ordinary browser profile continues to default to `http://127.0.0.1:3080`; `DSH_DESKTOP_HOST_URL` can explicitly select an already running loopback Web host. `DSH_DESKTOP_HOST_PATH` is reserved for development and diagnostic overrides. Backend child tools inherit Electron's Node-compatible executable mode, so existing `process.execPath` subprocess contracts continue to run as Node tools.

The second launch acquires no second instance lock. Its arguments are delivered to the existing process, which restores, shows, focuses, and briefly flashes the original window. Renderer isolation stays enabled, Node integration stays disabled, and external links open in the system browser. The named `dsh-github-oauth` popup is the exception: it stays inside Electron so the GitHub authorization callback can return to Harness.

The renderer's existing `light`/`dark`/`system` theme remains authoritative. It reports its computed surface and text colors over preload IPC so the native title-bar overlay follows custom palette changes without keeping a second palette in the Electron main process. The native window stays opaque while the Web profile is loading, so a startup failure never leaves the desktop visible behind the title-bar controls.

The renderer's `document.title` remains authoritative for the active session name. The native window title uses `DeepSeek Harness` for the product default and prefixes non-default page titles with `DeepSeek Harness -`; the same value is sent through preload IPC to the native `BrowserWindow` title. The visible desktop title row keeps the fixed `DeepSeek Harness` product identity. The main process accepts only bounded, single-line title values.

The renderer places the desktop title row before `#root` in normal layout flow. Plugin-owned slots remain inside `#root` and are not covered or replaced by desktop chrome; top-level right-edge fixed plugin panels and the known `dsh-better-sidebar` toggle cluster receive shell-owned inset attributes, while browser controls, other plugin toolbars, full-window overlays, and ordinary plugin content remain untouched. The title row and sidebar share `--dsw-specific-sidebar-fill`; the frame exposes that token through the center work column's rounded upper-left corner, while the work area keeps the base surface.

The desktop shell owns a small native context menu. Editable fields expose Copy, Cut, Paste, and Select all, with Delete when a selection exists; selected ordinary text exposes Copy only; images expose Copy and Save image as. The edit commands are explicit shell actions, so the menu does not display keyboard shortcut labels. No navigation, developer, spell-check, or plugin-specific commands are added to this menu.
