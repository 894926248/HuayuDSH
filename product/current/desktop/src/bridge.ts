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

/** IPC channel names owned by the desktop shell. */
export const DESKTOP_IPC = {
  activate: 'dsh:activate',
  notificationState: 'dsh:notification-state',
  titleBarColors: 'dsh:title-bar-colors',
  windowTitle: 'dsh:window-title',
} as const
