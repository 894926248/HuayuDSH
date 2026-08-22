import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopNotificationState, DesktopThemeColors } from './bridge.ts'
import { DESKTOP_IPC } from './bridge.ts'

interface DesktopBridge {
  readonly isDesktop: true
  setNotificationState(state: DesktopNotificationState): void
  setTitleBarColors(colors: DesktopThemeColors): void
  setWindowTitle(title: string): void
  onActivate(listener: () => void): () => void
}

const bridge: DesktopBridge = {
  isDesktop: true,
  setNotificationState(state) {
    ipcRenderer.send(DESKTOP_IPC.notificationState, state)
  },
  setTitleBarColors(colors) {
    ipcRenderer.send(DESKTOP_IPC.titleBarColors, colors)
  },
  setWindowTitle(title) {
    ipcRenderer.send(DESKTOP_IPC.windowTitle, title)
  },
  onActivate(listener) {
    const handle = (): void => { listener() }
    ipcRenderer.on(DESKTOP_IPC.activate, handle)
    return () => { ipcRenderer.removeListener(DESKTOP_IPC.activate, handle) }
  },
}

contextBridge.exposeInMainWorld('dshDesktop', bridge)
