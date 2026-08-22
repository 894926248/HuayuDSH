import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { inspect } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
} from 'electron'
import type { BrowserWindowConstructorOptions, ContextMenuParams, PopupOptions } from 'electron'
import type { DesktopNotificationState, DesktopThemeColors } from './bridge.ts'
import { DESKTOP_IPC } from './bridge.ts'
import { buildContextMenuTemplate } from './context-menu.ts'
import { isDshWebHostResponse } from './dsh-web-host.ts'
import { PACKAGED_HOST_ENTRY, resolveDevelopmentHostEntry } from './host-path.ts'

const TITLE_BAR_HEIGHT = 36
const HOST_START_TIMEOUT_MS = 30_000
const HOST_REQUEST_TIMEOUT_MS = 1_000
const OFFICIAL_HOST_PORT = 3_080
const HOST_LOAD_ATTEMPTS = 3
const HOST_LOAD_RETRY_DELAY_MS = 200
// Keep the OAuth child in Electron so its local callback can return to Harness.
const GITHUB_OAUTH_POPUP_NAME = 'dsh-github-oauth'
const GITHUB_OAUTH_POPUP_OPTIONS: BrowserWindowConstructorOptions = {
  width: 620,
  height: 760,
  minWidth: 480,
  minHeight: 560,
  autoHideMenuBar: true,
  title: 'GitHub sign-in',
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
}
const PRODUCT_TITLE = 'DeepSeek Harness'
const APP_USER_MODEL_ID = 'ai.deepseek.harness'
const MAX_WINDOW_TITLE_LENGTH = 512
const LIGHT_CHROME = { background: '#ffffff', foreground: '#0f1115' } as const
const DARK_CHROME = { background: '#232324', foreground: '#f9fafb' } as const
const RUNTIME_ICON_FILES = {
  light: 'icon-light.png',
  dark: 'icon-dark.png',
} as const
const HOST_PAYLOAD_METADATA_FILE = '.desktop-host-payload.json'
const HOST_MATERIALIZED_FILE = '.desktop-host-materialized.json'
const NOTIFICATION_OVERLAY_ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAf0lEQVR4nO3XwQ0AIQgEQIuz/zL8WgL3N8FDjmXPBBO+7qiJYms3DREZlqKEQjDrZLN3sVQIwhO8g6SHuxFRwRokbeXHO4EMNyHQ4a9HQQVkhauIAhSgAAWgA+hX8a8AtOcYjTC3ZtSWDLET1M449G+Q/jHREKf1KdyLCQ1FjweHex412zUMiQAAAABJRU5ErkJggg=='

let mainWindow: BrowserWindow | undefined
let host: DshHost | undefined
let hostUrl: URL | undefined
let quitting = false
let notificationOverlayIcon: Electron.NativeImage | undefined
let taskbarNotificationActive = false
let taskbarNotificationCount = 0

interface EmbeddedWebProfile {
  ctx: { get(name: string): unknown }
  shutdown: { shutdown(code: number): Promise<void> }
}

interface OfficialProfileBootModule {
  runProfile(options: {
    environment: unknown
    profile: string
    patchFiles: readonly string[]
    args: readonly string[]
  }): Promise<EmbeddedWebProfile>
}

interface OfficialAppBootModule {
  loadLayeredEnv(binName: string): unknown
}

/** Official Web profile mounted in the Electron main process. */
class DshHost {
  private profile: EmbeddedWebProfile | undefined

  /** Start the unmodified official Web profile on the fixed internal port. */
  async start(): Promise<URL> {
    const configuredUrl = process.env.DSH_DESKTOP_HOST_URL
    if (configuredUrl !== undefined) return parseLoopbackUrl(configuredUrl)
    const entry = await resolveHostEntry()
    const profileEntry = await resolveProfileBootEntry(entry)
    const requireFromHost = createRequire(pathToFileURL(entry))
    const appBootEntry = requireFromHost.resolve('@deepseek-ai/dsh-app-boot')
    const profileBoot = await import(pathToFileURL(profileEntry).href) as unknown as OfficialProfileBootModule
    const appBoot = await import(pathToFileURL(appBootEntry).href) as unknown as OfficialAppBootModule
    if (typeof profileBoot.runProfile !== 'function' || typeof appBoot.loadLayeredEnv !== 'function') {
      throw new Error(`desktop: official embedded Web profile exports are missing near ${entry}`)
    }
    process.env.ELECTRON_RUN_AS_NODE = '1'
    const profile = await profileBoot.runProfile({
      environment: appBoot.loadLayeredEnv('dsh'),
      profile: 'web',
      patchFiles: [],
      args: ['--no-open', '--port', String(OFFICIAL_HOST_PORT)],
    })
    this.profile = profile
    const webServer = profile.ctx.get('webServer') as { port?: unknown } | undefined
    const port = webServer?.port
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
      await this.stop()
      throw new Error('desktop: official embedded Web profile did not publish a listening port')
    }
    if (port !== OFFICIAL_HOST_PORT) {
      await this.stop()
      throw new Error(`desktop: official Web profile listened on unexpected port ${String(port)}`)
    }
    const url = new URL(`http://127.0.0.1:${String(port)}`)
    await waitForHost(url)
    return url
  }

  /** Dispose the official Web profile before Electron exits. */
  async stop(): Promise<void> {
    const profile = this.profile
    this.profile = undefined
    if (profile === undefined) return
    await profile.shutdown.shutdown(0)
  }
}

/** Resolve the hashed official profile module referenced by the official CLI bundle. */
async function resolveProfileBootEntry(entry: string): Promise<string> {
  const source = await readFile(entry, 'utf8')
  const importPath = source.match(/["']\.\/(profile-boot-[^"']+\.js)["']/u)?.[1]
  if (importPath === undefined) {
    throw new Error(`desktop: official CLI bundle does not reference a profile boot module: ${entry}`)
  }
  const profileEntry = join(dirname(entry), importPath)
  if (!existsSync(profileEntry)) {
    throw new Error(`desktop: official profile boot module is missing at ${profileEntry}`)
  }
  return profileEntry
}

async function probeHost(url: URL): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(HOST_REQUEST_TIMEOUT_MS) })
  const document = await response.text()
  if (!isDshWebHostResponse(response.status, response.headers.get('content-type'), document)) {
    throw new Error(`dsh web returned an unexpected response at ${url.toString()} (HTTP ${String(response.status)})`)
  }
}

async function waitForHost(url: URL, timeoutMs = HOST_START_TIMEOUT_MS): Promise<void> {
  let lastError: unknown
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await probeHost(url)
      return
    } catch (error) {
      lastError = error
    }
    await new Promise<void>((resolve) => { setTimeout(resolve, 100) })
  }
  throw new Error(`dsh web did not accept connections at ${url.toString()}: ${String(lastError)}`)
}

async function loadHostPage(window: BrowserWindow, url: URL): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= HOST_LOAD_ATTEMPTS; attempt += 1) {
    try {
      await waitForHost(url, HOST_REQUEST_TIMEOUT_MS)
      await window.loadURL(url.toString())
      return
    } catch (error) {
      lastError = error
      console.warn(`desktop: Web renderer load attempt ${String(attempt)} failed for ${url.toString()}: ${String(error)}`)
      if (attempt < HOST_LOAD_ATTEMPTS) {
        await new Promise<void>((resolve) => { setTimeout(resolve, HOST_LOAD_RETRY_DELAY_MS) })
      }
    }
  }
  throw new Error(`desktop: failed to load the Web renderer at ${url.toString()}: ${String(lastError)}`)
}

async function resolveHostEntry(): Promise<string> {
  const explicitEntry = process.env.DSH_DESKTOP_HOST_PATH
  if (!app.isPackaged) {
    return resolveDevelopmentHostEntry(app.getAppPath(), explicitEntry, process.env.DSH_DESKTOP_SOURCE_ROOT)
  }

  const packagedRoot = await materializePackagedHost()
  const sourceEntry = explicitEntry ?? join(packagedRoot, PACKAGED_HOST_ENTRY)
  if (!existsSync(sourceEntry)) {
    throw new Error(`desktop: packaged host entry is missing at ${sourceEntry}; rebuild the desktop package`)
  }
  return sourceEntry
}
interface HostPayloadLink {
  path: string
  target: string
  targetType: 'directory' | 'file' | 'missing'
}

interface HostPayloadMetadata {
  id: string
  links: HostPayloadLink[]
}

async function materializePackagedHost(): Promise<string> {
  const payloadRoot = join(process.resourcesPath, 'dsh-host-payload')
  const metadata = await readPayloadMetadata(payloadRoot)
  const hostRoot = join(app.getPath('userData'), 'host-runtime', metadata.id)
  if (existsSync(join(hostRoot, HOST_MATERIALIZED_FILE))) return hostRoot

  await rm(hostRoot, { recursive: true, force: true })
  await mkdir(dirname(hostRoot), { recursive: true })
  await cp(payloadRoot, hostRoot, { recursive: true, force: true })
  for (const link of metadata.links) {
    const path = join(hostRoot, link.path)
    await mkdir(dirname(path), { recursive: true })
    await symlink(link.target, path, link.targetType === 'file' ? 'file' : 'dir')
  }
  await rm(join(hostRoot, HOST_PAYLOAD_METADATA_FILE), { force: true })
  await writeFile(join(hostRoot, HOST_MATERIALIZED_FILE), `${JSON.stringify({ id: metadata.id })}\n`)
  return hostRoot
}

async function readPayloadMetadata(root: string): Promise<HostPayloadMetadata> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(join(root, HOST_PAYLOAD_METADATA_FILE), 'utf8'))
  } catch (error) {
    throw new Error(`desktop: cannot read packaged host payload metadata: ${String(error)}`)
  }
  if (typeof value !== 'object' || value === null || !('id' in value) || !('links' in value)) {
    throw new Error('desktop: packaged host payload metadata is invalid')
  }
  const metadata = value as Partial<HostPayloadMetadata>
  if (typeof metadata.id !== 'string' || !Array.isArray(metadata.links)) {
    throw new Error('desktop: packaged host payload metadata is invalid')
  }
  for (const link of metadata.links) {
    if (typeof link.path !== 'string' || typeof link.target !== 'string'
      || !['directory', 'file', 'missing'].includes(link.targetType)) {
      throw new Error('desktop: packaged host payload link metadata is invalid')
    }
  }
  return metadata as HostPayloadMetadata
}

function parseLoopbackUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`desktop: DSH_DESKTOP_HOST_URL must be an HTTP loopback URL, got ${JSON.stringify(value)}`)
  }
  return url
}

function isCssColor(value: unknown): value is string {
  return typeof value === 'string'
    && /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^\r\n]+\)|[a-z]+)$/iu.test(value.trim())
}

function isWindowTitle(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_WINDOW_TITLE_LENGTH
    && !/[\u0000\r\n]/u.test(value)
}

function themeFallback(): DesktopThemeColors {
  const isDark = nativeTheme.shouldUseDarkColors
  return {
    ...(isDark ? DARK_CHROME : LIGHT_CHROME),
    isDark,
  }
}

function runtimeIconPath(isDark: boolean): string {
  const fileName = RUNTIME_ICON_FILES[isDark ? 'dark' : 'light']
  if (app.isPackaged) return join(process.resourcesPath, 'icons', fileName)
  return join(app.getAppPath(), 'build', fileName)
}

function applyAppIcon(isDark = nativeTheme.shouldUseDarkColors): void {
  if (mainWindow === undefined || !['win32', 'linux'].includes(process.platform)) return
  const iconPath = runtimeIconPath(isDark)
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    console.warn(`desktop: native app icon is missing at ${iconPath}`)
    return
  }
  mainWindow.setIcon(icon)
}

function applyTitleBarColors(colors: DesktopThemeColors = themeFallback()): void {
  if (mainWindow === undefined) return
  applyAppIcon(colors.isDark)
  const next = {
    background: isCssColor(colors.background) ? colors.background : themeFallback().background,
    foreground: isCssColor(colors.foreground) ? colors.foreground : themeFallback().foreground,
  }
  mainWindow.setBackgroundColor(next.background)
  if (process.platform === 'win32') {
    mainWindow.setTitleBarOverlay({
      color: next.background,
      symbolColor: next.foreground,
      height: TITLE_BAR_HEIGHT,
    })
  }
}

function contextMenuLabels() {
  const chinese = app.getLocale().toLowerCase().startsWith('zh')
  return chinese
    ? { copy: '复制', cut: '剪切', paste: '粘贴', selectAll: '全选', delete: '删除', saveImageAs: '图片另存为' }
    : { copy: 'Copy', cut: 'Cut', paste: 'Paste', selectAll: 'Select all', delete: 'Delete', saveImageAs: 'Save image as' }
}

function imageSaveName(params: ContextMenuParams): string {
  const fromParams = params.suggestedFilename.trim()
  let candidate = fromParams
  if (candidate === '') {
    try {
      const path = new URL(params.srcURL).pathname
      candidate = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
    } catch {
      candidate = ''
    }
  }
  const safe = candidate.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').trim()
  return safe === '' ? 'image' : safe
}

async function saveImageAs(window: BrowserWindow, params: ContextMenuParams): Promise<void> {
  if (params.srcURL === '' || window.isDestroyed()) return
  const labels = contextMenuLabels()
  const result = await dialog.showSaveDialog(window, {
    title: labels.saveImageAs,
    defaultPath: imageSaveName(params),
    filters: [{ name: labels.saveImageAs, extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
  })
  if (result.canceled || result.filePath === undefined || window.isDestroyed()) return

  const contents = window.webContents
  const session = contents.session
  const onWillDownload = (_event: Electron.Event, item: Electron.DownloadItem, owner: Electron.WebContents): void => {
    if (owner !== contents) return
    item.setSavePath(result.filePath)
    session.removeListener('will-download', onWillDownload)
  }
  session.on('will-download', onWillDownload)
  try {
    contents.downloadURL(params.srcURL)
  } catch (error) {
    session.removeListener('will-download', onWillDownload)
    console.error(`desktop: image save failed: ${String(error)}`)
  }
}

function attachContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (event, params) => {
    event.preventDefault()
    const items = buildContextMenuTemplate(params, contextMenuLabels(), {
      copy: () => {
        if (!window.isDestroyed()) window.webContents.copy()
      },
      cut: () => {
        if (!window.isDestroyed()) window.webContents.cut()
      },
      paste: () => {
        if (!window.isDestroyed()) window.webContents.paste()
      },
      selectAll: () => {
        if (!window.isDestroyed()) window.webContents.selectAll()
      },
      delete: () => {
        if (!window.isDestroyed()) window.webContents.delete()
      },
      copyImage: () => {
        if (!window.isDestroyed()) window.webContents.copyImageAt(params.x, params.y)
      },
      saveImageAs: () => { void saveImageAs(window, params) },
    })
    if (items.length === 0) return
    const popupOptions: PopupOptions = {
      window,
      x: params.x,
      y: params.y,
      sourceType: params.menuSourceType,
    }
    if (params.frame !== null) popupOptions.frame = params.frame
    Menu.buildFromTemplate(items).popup(popupOptions)
  })
}

function isDesktopNotificationState(value: unknown): value is DesktopNotificationState {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Partial<DesktopNotificationState>
  return typeof state.active === 'boolean'
    && typeof state.count === 'number'
    && Number.isSafeInteger(state.count)
    && state.count >= 0
    && state.count <= 9_999
}

function getNotificationOverlayIcon(): Electron.NativeImage {
  notificationOverlayIcon ??= nativeImage.createFromBuffer(Buffer.from(NOTIFICATION_OVERLAY_ICON_BASE64, 'base64'))
  return notificationOverlayIcon
}

function applyTaskbarNotification(state: DesktopNotificationState): void {
  const active = state.active && state.count > 0
  const count = active ? state.count : 0
  if (active === taskbarNotificationActive && count === taskbarNotificationCount) return
  taskbarNotificationActive = active
  taskbarNotificationCount = count

  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  if (process.platform === 'win32') {
    mainWindow.flashFrame(active)
    mainWindow.setOverlayIcon(
      active ? getNotificationOverlayIcon() : null,
      active ? `${String(count)} new message${count === 1 ? '' : 's'}` : '',
    )
  } else if (process.platform === 'darwin') {
    app.dock?.setBadge(active ? String(count) : '')
  } else if (active) {
    mainWindow.flashFrame(true)
  } else {
    mainWindow.flashFrame(false)
  }
}

function clearTaskbarNotification(): void {
  applyTaskbarNotification({ active: false, count: 0 })
}

function focusMainWindow(): void {
  if (mainWindow === undefined) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  clearTaskbarNotification()
  if (process.platform === 'win32') mainWindow.flashFrame(true)
  mainWindow.webContents.send(DESKTOP_IPC.activate)
}

async function createMainWindow(): Promise<void> {
  host = new DshHost()
  hostUrl = await host.start()
  const preload = fileURLToPath(new URL('./preload.js', import.meta.url))
  const options: BrowserWindowConstructorOptions = {
    width: 1_440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: themeFallback().background,
    icon: runtimeIconPath(themeFallback().isDark),
    title: PRODUCT_TITLE,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    transparent: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  }
  if (process.platform === 'win32') {
    options.titleBarOverlay = {
      color: themeFallback().background,
      symbolColor: themeFallback().foreground,
      height: TITLE_BAR_HEIGHT,
    }
  }

  const window = new BrowserWindow(options)
  mainWindow = window
  attachContextMenu(window)
  applyTitleBarColors()
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url === 'about:blank' && frameName === GITHUB_OAUTH_POPUP_NAME) {
      return { action: 'allow', overrideBrowserWindowOptions: GITHUB_OAUTH_POPUP_OPTIONS }
    }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (hostUrl !== undefined && new URL(url).origin === hostUrl.origin) return
    event.preventDefault()
    void shell.openExternal(url)
  })
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      console.error(`desktop: Web renderer navigation failed (${String(errorCode)} ${errorDescription}) at ${validatedURL}`)
    }
  })
  window.once('ready-to-show', () => {
    window.show()
    window.focus()
  })
  window.on('focus', clearTaskbarNotification)
  await loadHostPage(window, hostUrl)
}

ipcMain.on(DESKTOP_IPC.titleBarColors, (event, value: unknown) => {
  if (mainWindow === undefined || event.sender.id !== mainWindow.webContents.id) return
  if (typeof value !== 'object' || value === null) return
  const colors = value as Partial<DesktopThemeColors>
  if (!isCssColor(colors.background) || !isCssColor(colors.foreground) || typeof colors.isDark !== 'boolean') return
  applyTitleBarColors({ background: colors.background, foreground: colors.foreground, isDark: colors.isDark })
})

ipcMain.on(DESKTOP_IPC.notificationState, (event, value: unknown) => {
  if (mainWindow === undefined || event.sender.id !== mainWindow.webContents.id) return
  if (!isDesktopNotificationState(value)) return
  applyTaskbarNotification(value)
})

ipcMain.on(DESKTOP_IPC.windowTitle, (event, value: unknown) => {
  if (mainWindow === undefined || event.sender.id !== mainWindow.webContents.id) return
  if (!isWindowTitle(value)) return
  const title = value.trim()
  mainWindow.setTitle(title === '' ? PRODUCT_TITLE : title)
})

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.setAppUserModelId(APP_USER_MODEL_ID)
  nativeTheme.themeSource = 'system'
  app.on('second-instance', () => { focusMainWindow() })
  nativeTheme.on('updated', () => { applyTitleBarColors() })
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void (host?.stop() ?? Promise.resolve()).finally(() => { app.quit() })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (mainWindow === undefined) void createMainWindow().catch(handleStartupError)
    else focusMainWindow()
  })
  void app.whenReady().then(() => createMainWindow()).catch(handleStartupError)
}

function handleStartupError(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error)
  console.error(inspect(error, { depth: Infinity, colors: false }))
  dialog.showErrorBox('DeepSeek Harness', reason)
  app.quit()
}
