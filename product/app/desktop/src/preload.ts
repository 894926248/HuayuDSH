import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopLastErrorsDocument, DesktopNotificationState, DesktopThemeColors, DesktopVersionInfo } from './bridge.ts'
import { DESKTOP_IPC } from './bridge.ts'

interface DesktopBridge {
  readonly isDesktop: true
  readonly currentUpstreamVersion: string
  openUpdate(): void
  listVersions(): Promise<DesktopVersionInfo[]>
  switchVersion(id: string): Promise<void>
  setNotificationState(state: DesktopNotificationState): void
  setTitleBarColors(colors: DesktopThemeColors): void
  setWindowTitle(title: string): void
  /** Pull the most recent captured error document from the desktop shell's JSON store. */
  getLastErrors(): Promise<DesktopLastErrorsDocument>
  /** Trigger an immediate flush + broadcast; useful for "refresh" buttons in the UI. */
  refreshLastErrors(): Promise<DesktopLastErrorsDocument>
  /** Subscribe to main-proc broadcasts when new errors are captured. */
  onLastErrorsUpdate(listener: (document: DesktopLastErrorsDocument) => void): () => void
  onActivate(listener: () => void): () => void
  /** Read a namespaced UI-state JSON value (persisted in userData, stable across host ports). */
  readUiState(key: string): Promise<string | null>
  /** Persist a namespaced UI-state JSON value (null deletes); resolves once flushed. */
  writeUiState(key: string, value: string | null): Promise<void>
  /** Reload the host page without restarting the host process (same origin/port). */
  reloadHostPage(): void
  /** Restart the host process (used by the built-in plugin manager for host-only plugins). */
  restartHost(): void
}

const bridge: DesktopBridge = {
  isDesktop: true,
  currentUpstreamVersion: ipcRenderer.sendSync(DESKTOP_IPC.currentUpstreamVersion) as string,
  openUpdate() {
    ipcRenderer.send(DESKTOP_IPC.openUpdate)
  },
  listVersions() {
    return ipcRenderer.invoke(DESKTOP_IPC.listVersions) as Promise<DesktopVersionInfo[]>
  },
  switchVersion(id) {
    return ipcRenderer.invoke(DESKTOP_IPC.switchVersion, id) as Promise<void>
  },
  setNotificationState(state) {
    ipcRenderer.send(DESKTOP_IPC.notificationState, state)
  },
  setTitleBarColors(colors) {
    ipcRenderer.send(DESKTOP_IPC.titleBarColors, colors)
  },
  setWindowTitle(title) {
    ipcRenderer.send(DESKTOP_IPC.windowTitle, title)
  },
  getLastErrors() {
    return ipcRenderer.invoke(DESKTOP_IPC.getLastErrors) as Promise<DesktopLastErrorsDocument>
  },
  refreshLastErrors() {
    return ipcRenderer.invoke(DESKTOP_IPC.refreshLastErrors) as Promise<DesktopLastErrorsDocument>
  },
  onLastErrorsUpdate(listener) {
    const handler = (_event: Electron.IpcRendererEvent, document: DesktopLastErrorsDocument): void => {
      listener(document)
    }
    ipcRenderer.on(DESKTOP_IPC.lastErrorsUpdate, handler)
    return () => { ipcRenderer.removeListener(DESKTOP_IPC.lastErrorsUpdate, handler) }
  },
  onActivate(listener) {
    const handle = (): void => { listener() }
    ipcRenderer.on(DESKTOP_IPC.activate, handle)
    return () => { ipcRenderer.removeListener(DESKTOP_IPC.activate, handle) }
  },
  readUiState(key) {
    return ipcRenderer.invoke(DESKTOP_IPC.readUiState, key) as Promise<string | null>
  },
  writeUiState(key, value) {
    return ipcRenderer.invoke(DESKTOP_IPC.writeUiState, key, value) as Promise<void>
  },
  reloadHostPage() {
    ipcRenderer.send(DESKTOP_IPC.reloadHostPage)
  },
  restartHost() {
    ipcRenderer.send(DESKTOP_IPC.restartHost)
  },
}

contextBridge.exposeInMainWorld('dshDesktop', bridge)
