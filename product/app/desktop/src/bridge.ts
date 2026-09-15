/** Renderer-to-main values used by the isolated Electron preload. */
export interface DesktopThemeColors {
  /** The rendered window surface color. */
  background: string
  /** The rendered primary text color used by native title-bar symbols. */
  foreground: string
  /** Whether the rendered theme uses the dark palette. */
  isDark: boolean
}

/** Renderer-owned unread-session state projected to the native taskbar. */
export interface DesktopNotificationState {
  /** Whether at least one non-current session has a newly completed turn. */
  active: boolean
  /** Number of completed-session reminders currently visible in the renderer. */
  count: number
}

/** One product build shown by the desktop version selector. */
export interface DesktopVersionInfo {
  id: string
  productVersion: string
  upstreamVersion: string
  upstreamTag: string
  source: 'product' | 'official'
  switchable: boolean
  downloaded: boolean
  current: boolean
}

/** Single captured error row — what the desktop shell records from process stderr/stdout. */
export interface DesktopLastError {
  /** Unix epoch ms when the row was captured. */
  time: number
  /** Captured channel — "console-stdout" / "console-stderr" / "render-failed" / etc. */
  kind: string
  /** Source line (verbatim text the shell forwarded). May span multiple lines. */
  message: string
  /** Soft extra fields captured opportunistically; never required. */
  context?: Record<string, unknown>
}

/** Document returned by `dsh:get-last-errors` and pushed on every update. */
export interface DesktopLastErrorsDocument {
  /** ISO timestamp when the document was last rewritten. */
  updatedAt: string
  /** Captured errors, newest last. */
  entries: DesktopLastError[]
}

/** IPC channel names owned by the desktop shell. */
export const DESKTOP_IPC = {
  activate: 'dsh:activate',
  currentUpstreamVersion: 'dsh:current-upstream-version',
  openUpdate: 'dsh:open-update',
  listVersions: 'dsh:list-versions',
  switchVersion: 'dsh:switch-version',
  notificationState: 'dsh:notification-state',
  titleBarColors: 'dsh:title-bar-colors',
  windowTitle: 'dsh:window-title',
  /** Renderer pull — returns the host process's recent last-errors document. */
  getLastErrors: 'dsh:get-last-errors',
  /** Renderer pull — flush + push; updates the stored JSON and re-broadcasts to all windows. */
  refreshLastErrors: 'dsh:last-errors-refresh',
  /** Main → renderer push — sent whenever a new captured error is recorded. */
  lastErrorsUpdate: 'dsh:last-errors',
  /** Renderer pull — read a namespaced UI-state JSON value (persisted in userData, stable across host ports). */
  readUiState: 'dsh:ui-state-read',
  /** Renderer push — persist a namespaced UI-state JSON value under userData. */
  writeUiState: 'dsh:ui-state-write',
  /** Renderer request — reload the host page without restarting the host process (same origin/port). */
  reloadHostPage: 'dsh:reload-host-page',
  /** Renderer request — restart the host process (builtin plugin manager / R36 restart manager). */
  restartHost: 'dsh:restart-host',
} as const
