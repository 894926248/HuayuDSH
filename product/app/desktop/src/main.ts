import { createWriteStream, existsSync, readFileSync, watch, writeFileSync } from 'node:fs'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { inspect } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  session,
  shell,
} from 'electron'
import type { BrowserWindowConstructorOptions, ContextMenuParams, PopupOptions } from 'electron'
import type { DesktopNotificationState, DesktopThemeColors, DesktopVersionInfo } from './bridge.ts'
import { DESKTOP_IPC } from './bridge.ts'
import { buildContextMenuTemplate } from './context-menu.ts'
import { isDshWebHostResponse } from './dsh-web-host.ts'
import { OFFICIAL_PACKAGE_HOST_ENTRY, PACKAGED_HOST_ENTRY, resolveDevelopmentHostEntry, SOURCE_HOST_ENTRY } from './host-path.ts'
import { HarnessRecovery } from './harness-recovery/recovery.ts'
import { installConsoleForwarding, captureHostOutput, setBroadcastTarget } from './error-capture.ts'

if (process.env.DSH_DEBUG_CDP === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

// Tap the host process's stderr/stdout from the very first line — this is what the renderer reads
// via `dsh:get-last-errors` when a user clicks "查看诊断详情" on a failed turn.
installConsoleForwarding()

const HOST_START_TIMEOUT_MS = 30_000
const HOST_REQUEST_TIMEOUT_MS = 1_000
const HOST_LOAD_ATTEMPTS = 3
const HOST_LOAD_RETRY_DELAY_MS = 200
const HOST_OUTPUT_LIMIT = 16_384
const MODEL_WARMUP_DELAY_MS = 0
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
const PRODUCT_TITLE = 'DeepSeek'
const TITLE_BAR_HEIGHT = 36
const APP_USER_MODEL_ID = 'ai.deepseek.harness'
const PRODUCT_UPDATE_URL = process.env.DSH_UPDATE_URL ?? 'https://github.com/894926248/HuayuDSH/releases/latest'
const PRODUCT_RELEASES_API_URL = 'https://api.github.com/repos/894926248/HuayuDSH/releases?per_page=30'
const VERSION_REQUEST_TIMEOUT_MS = 5_000
const VERSION_DOWNLOAD_TIMEOUT_MS = 30 * 60_000
const MAX_WINDOW_TITLE_LENGTH = 512
const LIGHT_CHROME = { background: '#ffffff', foreground: '#0f1115' } as const
const DARK_CHROME = { background: '#232324', foreground: '#f9fafb' } as const
const RUNTIME_ICON_FILES = {
  light: 'icon-light.png',
  dark: 'icon-dark.png',
} as const
const HOST_ROOT_FILE = 'host-root.json'
const OFFICIAL_VERSIONS_FILE = 'official-versions.json'
const PROXY_PROBE_URL = 'https://api.deepseek.com'
const NOTIFICATION_OVERLAY_ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAf0lEQVR4nO3XwQ0AIQgEQIuz/zL8WgL3N8FDjmXPBBO+7qiJYms3DREZlqKEQjDrZLN3sVQIwhO8g6SHuxFRwRokbeXHO4EMNyHQ4a9HQQVkhauIAhSgAAWgA+hX8a8AtOcYjTC3ZtSWDLET1M449G+Q/jHREKf1KdyLCQ1FjweHex412zUMiQAAAABJRU5ErkJggg=='

interface VersionCandidate extends DesktopVersionInfo {
  executablePath: string
  downloadUrl: string
}

interface ReleaseLock {
  product?: { version?: unknown }
  upstream?: { version?: unknown; tag?: unknown }
}

interface OfficialVersion {
  version: string
  tag: string
  commit: string
}

/** Upstream tag feed. The static official-versions.json is only a snapshot
 *  taken at build time; this feed keeps the picker current at runtime. */
const UPSTREAM_VERSIONS_API_URL = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/tags?per_page=100'
const UPSTREAM_VERSIONS_CACHE_TTL_MS = 30 * 60_000
const UPSTREAM_VERSIONS_FETCH_TIMEOUT_MS = 4_000
const UPSTREAM_TAG_PATTERN = /^dsh-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u

interface RemoteRelease {
  id: string
  productVersion: string
  upstreamVersion: string
  downloadUrl: string
}

let mainWindow: BrowserWindow | undefined
let host: DshHost | undefined
let hostUrl: URL | undefined
let quitting = false
let notificationOverlayIcon: Electron.NativeImage | undefined
let taskbarNotificationActive = false
let taskbarNotificationCount = 0

function productRoot(): string {
  return resolve(app.getAppPath(), '..', '..', '..')
}

function versionStoreRoot(): string {
  if (!app.isPackaged) return join(productRoot(), '.workspace', 'artifacts', 'versions')
  return join(app.getPath('userData'), 'versions')
}

function releaseRoot(): string {
  if (!app.isPackaged) return join(productRoot(), '.workspace', 'artifacts', 'releases')
  return versionStoreRoot()
}

function versionId(productVersion: string): string {
  return `release:${productVersion}`
}

function upstreamVersionId(upstreamVersion: string): string {
  return `upstream:${upstreamVersion}`
}

function validVersionId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:release|upstream):[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseElectronProxy(proxyRules: string): string {
  for (const rule of proxyRules.split(';')) {
    const match = /^\s*(?:PROXY|HTTPS?)\s+(.+)\s*$/iu.exec(rule)
    const endpoint = match?.[1]?.trim()
    if (endpoint === undefined || endpoint === '') continue
    if (/^https?:\/\//iu.test(endpoint)) return endpoint
    if (/^[^\s:]+:\d+$/u.test(endpoint)) return `http://${endpoint}`
  }
  return ''
}

async function resolveHostProxyEnvironment(): Promise<Record<string, string>> {
  try {
    const rules = await session.defaultSession.resolveProxy(PROXY_PROBE_URL)
    const proxy = parseElectronProxy(rules)
    if (proxy === '') return { NODE_USE_ENV_PROXY: '1' }
    return {
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      ALL_PROXY: proxy,
      NODE_USE_ENV_PROXY: '1',
      NO_PROXY: process.env.NO_PROXY || 'localhost,127.0.0.1,::1',
    }
  } catch (error) {
    console.warn(`desktop: system proxy resolution failed; retaining inherited proxy environment: ${String(error)}`)
    return { NODE_USE_ENV_PROXY: '1' }
  }
}

function currentUpstreamVersion(): string {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'runtime', 'package.json')
    : join(productRoot(), 'upstream', 'package.json')
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
    return stringValue(value.version)
  } catch {
    return ''
  }
}

/**
 * Warm the host's model-directory cache in the background so the first user
 * open of the composer model picker does not pay the host's one-time
 * directory build (which can take tens of seconds). Best-effort: any failure
 * is ignored — the picker still loads on demand.
 */
async function warmUpModelDirectory(hostUrl: URL, delayMs = 0): Promise<void> {
  if (delayMs > 0) await new Promise<void>(resolve => { setTimeout(resolve, delayMs) })
  const call = async (method: string, payload: Record<string, unknown>): Promise<unknown> => {
    const response = await fetch(new URL(`/api/${method}`, hostUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `warmup-${method}`, method, payload }),
    })
    if (!response.ok) throw new Error(`${method} HTTP ${String(response.status)}`)
    const document = await response.json() as { result?: { ok?: boolean; value?: unknown } }
    if (document.result?.ok !== true) throw new Error(`${method} rejected`)
    return document.result.value
  }
  try {
    const listed = await call('session.list', {}) as { items?: Array<{ sessionId?: unknown }> }
    const items = Array.isArray(listed?.items) ? listed.items : []
    const sessionId = items.find(item => typeof item?.sessionId === 'string')?.sessionId
    if (typeof sessionId !== 'string') return
    await call('session.models', { sessionId })
  } catch (error) {
    // Pre-warm is best-effort; never fail boot over it.
    console.warn(`desktop: model directory pre-warm skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

async function readProductVersionManifest(): Promise<{ productVersion: string; upstreamVersion: string; upstreamTag: string }> {
  const productPath = app.isPackaged
    ? join(process.resourcesPath, 'product-version.json')
    : join(productRoot(), 'product', 'config', 'product-version.json')
  const runtimePackagePath = app.isPackaged
    ? join(process.resourcesPath, 'runtime', 'package.json')
    : join(productRoot(), 'upstream', 'package.json')
  const [product, upstream] = await Promise.all([readJsonFile(productPath), readJsonFile(runtimePackagePath)])
  return {
    productVersion: stringValue(product?.version) || app.getVersion(),
    upstreamVersion: stringValue(upstream?.version),
    upstreamTag: '',
  }
}

async function readReleaseMetadata(directory: string): Promise<{ productVersion: string; upstreamVersion: string; upstreamTag: string } | undefined> {
  const lock = await readJsonFile(join(directory, 'release-lock.json')) as ReleaseLock | undefined
  const productVersion = stringValue(lock?.product?.version)
  if (productVersion === '') return undefined
  return {
    productVersion,
    upstreamVersion: stringValue(lock?.upstream?.version),
    upstreamTag: stringValue(lock?.upstream?.tag),
  }
}

/** Tag rows as they arrive from the static snapshot or the live GitHub feed. */
function officialVersionRows(value: unknown): OfficialVersion[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (typeof item !== 'object' || item === null) return []
    const row = item as { name?: unknown; version?: unknown; tag?: unknown; commit?: unknown }
    const rawTag = stringValue(row.tag) || stringValue(row.name)
    const match = UPSTREAM_TAG_PATTERN.exec(rawTag)
    if (match === null) return []
    const version = stringValue(row.version) || match[1]!
    const commit = typeof row.commit === 'object' && row.commit !== null
      ? stringValue((row.commit as { sha?: unknown }).sha)
      : stringValue(row.commit)
    return [{ version, tag: rawTag, commit }]
  })
}

async function readStaticOfficialVersions(): Promise<OfficialVersion[]> {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'runtime', OFFICIAL_VERSIONS_FILE)
    : join(productRoot(), '.workspace', 'artifacts', 'staging', 'runtime', OFFICIAL_VERSIONS_FILE)
  const value = await readJsonFile(path)
  return officialVersionRows(value?.versions)
}

function upstreamVersionsCachePath(): string {
  return join(app.getPath('userData'), 'upstream-versions-cache.json')
}

async function readUpstreamVersionsCache(): Promise<{ fetchedAt: number; versions: OfficialVersion[] } | undefined> {
  const value = await readJsonFile(upstreamVersionsCachePath())
  const versions = officialVersionRows(value?.versions)
  const fetchedAt = typeof value?.fetchedAt === 'number' ? value.fetchedAt : 0
  return versions.length > 0 ? { fetchedAt, versions } : undefined
}

async function writeUpstreamVersionsCache(versions: OfficialVersion[]): Promise<void> {
  const path = upstreamVersionsCachePath()
  const temporary = `${path}.tmp-${String(process.pid)}`
  try {
    await writeFile(temporary, `${JSON.stringify({ fetchedAt: Date.now(), versions }, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/** Live upstream tags. Resolves undefined when the feed is unreachable. */
async function fetchUpstreamVersions(): Promise<OfficialVersion[] | undefined> {
  try {
    const response = await fetch(UPSTREAM_VERSIONS_API_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DeepSeek-Harness' },
      signal: AbortSignal.timeout(UPSTREAM_VERSIONS_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const versions = officialVersionRows(await response.json())
    return versions.length > 0 ? versions : undefined
  } catch {
    return undefined
  }
}

/** Union by tag, live rows winning, newest last. */
function mergeOfficialVersions(fallback: OfficialVersion[], live: OfficialVersion[]): OfficialVersion[] {
  const merged = new Map<string, OfficialVersion>()
  for (const row of [...fallback, ...live]) merged.set(row.tag, row)
  return [...merged.values()].sort((left, right) => (
    left.version.localeCompare(right.version, undefined, { numeric: true })
  ))
}

/**
 * Official versions for the picker: the build-time snapshot unioned with the
 * live upstream tag feed. A fresh on-disk cache answers immediately and a
 * stale one triggers a background refresh; with no cache at all the feed is
 * awaited under a short timeout so the first open can already show new tags.
 */
async function readOfficialVersions(): Promise<OfficialVersion[]> {
  const [snapshot, cached] = await Promise.all([readStaticOfficialVersions(), readUpstreamVersionsCache()])
  if (cached !== undefined && Date.now() - cached.fetchedAt < UPSTREAM_VERSIONS_CACHE_TTL_MS) {
    return mergeOfficialVersions(snapshot, cached.versions)
  }
  const refresh = fetchUpstreamVersions().then(async live => {
    if (live === undefined) return
    await writeUpstreamVersionsCache(live).catch(() => undefined)
  })
  if (cached === undefined) {
    // First run: a bounded wait keeps the picker honest without stalling it.
    await Promise.race([refresh, new Promise(resolve => setTimeout(resolve, UPSTREAM_VERSIONS_FETCH_TIMEOUT_MS))])
    const live = await readUpstreamVersionsCache()
    return mergeOfficialVersions(snapshot, live?.versions ?? [])
  }
  void refresh
  return mergeOfficialVersions(snapshot, cached.versions)
}

function mergeVersion(map: Map<string, VersionCandidate>, candidate: VersionCandidate): void {
  const previous = map.get(candidate.id)
  if (previous === undefined) {
    map.set(candidate.id, candidate)
    return
  }
  map.set(candidate.id, {
    ...previous,
    ...candidate,
    current: previous.current || candidate.current,
    downloaded: previous.downloaded || candidate.downloaded,
    executablePath: candidate.current ? candidate.executablePath : previous.executablePath,
    downloadUrl: candidate.downloadUrl || previous.downloadUrl,
  })
}

async function scanLocalVersions(): Promise<Map<string, VersionCandidate>> {
  const versions = new Map<string, VersionCandidate>()
  const currentMetadata = await readReleaseMetadata(dirname(process.execPath)) ?? await readProductVersionManifest()
  mergeVersion(versions, {
    id: versionId(currentMetadata.productVersion),
    productVersion: currentMetadata.productVersion,
    upstreamVersion: currentMetadata.upstreamVersion,
    upstreamTag: currentMetadata.upstreamTag,
    source: 'product',
    switchable: true,
    downloaded: true,
    current: true,
    executablePath: process.execPath,
    downloadUrl: '',
  })

  const roots = [releaseRoot(), versionStoreRoot()]
  for (const root of roots) {
    let entries
    try { entries = await readdir(root, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const directory = join(root, entry.name)
      const executable = join(directory, 'DeepSeek Harness.exe')
      if (!existsSync(executable)) continue
      const metadata = await readReleaseMetadata(directory) ?? await readJsonFile(join(directory, 'version.json'))
      const metadataRecord = metadata as Record<string, unknown> | undefined
      const productRecord = typeof metadataRecord?.product === 'object' && metadataRecord.product !== null
        ? metadataRecord.product as Record<string, unknown>
        : undefined
      const upstreamRecord = typeof metadataRecord?.upstream === 'object' && metadataRecord.upstream !== null
        ? metadataRecord.upstream as Record<string, unknown>
        : undefined
      const productVersion = stringValue(productRecord?.version) || stringValue(metadataRecord?.productVersion)
      if (productVersion === '') continue
      const upstreamVersion = stringValue(upstreamRecord?.version) || stringValue(metadataRecord?.upstreamVersion)
      const upstreamTag = stringValue(upstreamRecord?.tag) || stringValue(metadataRecord?.upstreamTag)
      mergeVersion(versions, {
        id: versionId(productVersion),
        productVersion,
        upstreamVersion,
        upstreamTag,
        source: 'product',
        switchable: true,
        downloaded: true,
        current: false,
        executablePath: executable,
        downloadUrl: '',
      })
    }
  }
  return versions
}

async function fetchRemoteReleases(): Promise<RemoteRelease[]> {
  try {
    const response = await fetch(PRODUCT_RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DeepSeek-Harness' },
      signal: AbortSignal.timeout(VERSION_REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) return []
    const payload: unknown = await response.json()
    if (!Array.isArray(payload)) return []
    const releases: RemoteRelease[] = []
    for (const value of payload) {
      if (typeof value !== 'object' || value === null) continue
      const release = value as { tag_name?: unknown; name?: unknown; assets?: unknown }
      const tag = stringValue(release.tag_name)
      const productVersion = tag.replace(/^v/u, '')
      if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(productVersion)) continue
      if (!Array.isArray(release.assets)) continue
      const asset = release.assets.find(item => {
        if (typeof item !== 'object' || item === null) return false
        const name = stringValue((item as { name?: unknown }).name).toLowerCase()
        return name === 'deepseek harness.exe' || name.endsWith('.exe')
      }) as { browser_download_url?: unknown } | undefined
      const downloadUrl = stringValue(asset?.browser_download_url)
      if (!/^https:\/\/github\.com\//u.test(downloadUrl)) continue
      releases.push({
        id: versionId(productVersion),
        productVersion,
        upstreamVersion: stringValue(release.name),
        downloadUrl,
      })
    }
    return releases
  } catch {
    return []
  }
}

async function listVersionCandidates(): Promise<VersionCandidate[]> {
  const local = await scanLocalVersions()
  const officialVersions = await readOfficialVersions()
  for (const remote of await fetchRemoteReleases()) {
    const existing = local.get(remote.id)
    if (existing !== undefined) {
      existing.downloadUrl = remote.downloadUrl
      if (existing.upstreamVersion === '') existing.upstreamVersion = remote.upstreamVersion
      continue
    }
    local.set(remote.id, {
      ...remote,
      upstreamTag: '',
      source: 'product',
      switchable: true,
      downloaded: false,
      current: false,
      executablePath: '',
    })
  }
  for (const official of officialVersions) {
    const existing = [...local.values()].find(version => version.upstreamVersion === official.version)
    if (existing !== undefined) {
      existing.upstreamTag = official.tag
      continue
    }
    local.set(upstreamVersionId(official.version), {
      id: upstreamVersionId(official.version),
      productVersion: '',
      upstreamVersion: official.version,
      upstreamTag: official.tag,
      source: 'official',
      switchable: false,
      downloaded: false,
      current: false,
      executablePath: '',
      downloadUrl: '',
    })
  }
  const officialSet = new Set(officialVersions.map(version => version.version))
  return [...local.values()].filter(version => officialSet.has(version.upstreamVersion)).sort((left, right) => {
    const leftVersion = left.upstreamVersion || left.productVersion
    const rightVersion = right.upstreamVersion || right.productVersion
    return leftVersion.localeCompare(rightVersion, undefined, { numeric: true })
  })
}

async function downloadVersion(remote: VersionCandidate): Promise<VersionCandidate> {
  if (!remote.switchable) throw new Error(`version ${remote.upstreamVersion} is an official source tag without a product build`)
  if (!remote.downloaded && remote.downloadUrl === '') throw new Error(`version ${remote.productVersion} has no download asset`)
  const directory = join(versionStoreRoot(), remote.productVersion)
  const executable = join(directory, 'DeepSeek Harness.exe')
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `DeepSeek Harness.exe.part-${String(process.pid)}`)
  const response = await fetch(remote.downloadUrl, {
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'DeepSeek-Harness' },
    signal: AbortSignal.timeout(VERSION_DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok || response.body === null) throw new Error(`version download failed (HTTP ${String(response.status)})`)
  try {
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temporary))
    await rename(temporary, executable)
    await writeFile(join(directory, 'version.json'), `${JSON.stringify({
      productVersion: remote.productVersion,
      upstreamVersion: remote.upstreamVersion,
      downloadedAtUtc: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8')
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
  return { ...remote, downloaded: true, executablePath: executable }
}

async function switchVersion(id: string): Promise<void> {
  if (!validVersionId(id)) throw new Error('desktop: invalid version id')
  let candidate = (await listVersionCandidates()).find(version => version.id === id)
  if (candidate === undefined) throw new Error(`desktop: version ${id} is not available`)
  if (!candidate.switchable) throw new Error(`desktop: official ${candidate.upstreamTag} is listed but has no complete product executable yet`)
  if (!candidate.downloaded) candidate = await downloadVersion(candidate)
  if (candidate.current || candidate.executablePath === process.execPath) return
  if (!existsSync(candidate.executablePath)) throw new Error(`desktop: downloaded version is missing at ${candidate.executablePath}`)
  app.relaunch({ execPath: candidate.executablePath, args: [] })
  app.exit(0)
}

/** Official Web profile running in its own CLI process. */
class DshHost {
  private child: ChildProcessByStdio<null, Readable, Readable> | undefined
  private recovery: HarnessRecovery | undefined
  private output = ''
  private exitReason: string | undefined

  /** Start the untouched official CLI profile and return its announced loopback URL. */
  async start(): Promise<URL> {
    const configuredUrl = process.env.DSH_DESKTOP_HOST_URL
    if (configuredUrl !== undefined) return parseLoopbackUrl(configuredUrl)
    const entry = await resolveHostEntry()
    // The official CLI resolves its Web assets from its working tree. Keep
    // that resolution anchored to the selected runtime package so a launch
    // from the repository (or a shortcut with another working directory)
    // cannot fall back to upstream/apps/web/dist.
    const hostRoot = resolve(dirname(entry), '..', '..', '..')
    const dshHome = resolveDshHome()
    const runtimePatch = join(hostRoot, 'runtime-recovery.patch.yml')
    const patchArg = await filteredRuntimePatchForDisabled(runtimePatch)
    const proxyEnvironment = await resolveHostProxyEnvironment()
    Object.assign(process.env, proxyEnvironment)
    this.output = ''
    this.exitReason = undefined
    const child = spawn(process.env.DSH_DESKTOP_NODE_EXECUTABLE ?? 'node', [
      '--expose-internals',
      entry,
      '--profile',
      'web',
      '--patch',
      patchArg,
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ], {
      cwd: hostRoot,
      env: {
        ...process.env,
        ...proxyEnvironment,
        DSH_DESKTOP: '1',
        DSH_DESKTOP_HOST_PATH: entry,
        DSH_HOME: dshHome,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    child.stdout.on('data', chunk => {
      captureHostOutput('stdout', chunk)
      this.appendOutput(chunk)
    })
    child.stderr.on('data', chunk => {
      captureHostOutput('stderr', chunk)
      this.appendOutput(chunk)
    })
    child.on('error', error => { this.exitReason = `failed to start: ${error.message}` })
    child.on('exit', (code, signal) => {
      this.exitReason = `exited before readiness (code ${String(code)}, signal ${signal ?? 'none'})`
    })

    try {
      const url = await this.waitForAnnouncedUrl()
      await waitForHost(url)
      // Warm the host's model-directory cache in the background, but only
      // after a grace window: the first session.models build is CPU-bound and
      // would stall the user's first session-switches if it ran immediately.
      void warmUpModelDirectory(url, MODEL_WARMUP_DELAY_MS)
      this.recovery = new HarnessRecovery({
        stateRoot: join(app.getPath('userData'), 'harness-recovery'),
      })
      await this.recovery.start(url)
      return url
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  /** Terminate the child profile when the owning Electron shell exits. */
  async stop(): Promise<void> {
    const recovery = this.recovery
    this.recovery = undefined
    await recovery?.stop()
    const child = this.child
    this.child = undefined
    if (child === undefined || child.exitCode !== null) return
    child.kill()
  }

  private appendOutput(chunk: Buffer | string): void {
    this.output = `${this.output}${chunk.toString()}`.slice(-HOST_OUTPUT_LIMIT)
  }

  private async waitForAnnouncedUrl(): Promise<URL> {
    const deadline = Date.now() + HOST_START_TIMEOUT_MS
    while (Date.now() < deadline) {
      const match = /\bdsh web:\s+(http:\/\/(?:127\.0\.0\.1|localhost):\d+)/iu.exec(this.output)
      const announcedUrl = match?.[1]
      if (announcedUrl !== undefined) return parseLoopbackUrl(announcedUrl)
      if (this.exitReason !== undefined) {
        const detail = this.output.trim()
        throw new Error(`desktop: official Web profile ${this.exitReason}${detail === '' ? '' : `\n${detail}`}`)
      }
      await new Promise<void>((resolve) => { setTimeout(resolve, 50) })
    }
    const detail = this.output.trim()
    throw new Error(`desktop: official Web profile did not announce a loopback URL${detail === '' ? '' : `\n${detail}`}`)
  }
}

function resolveDshHome(): string {
  const userHome = process.env.USERPROFILE
    || (process.env.HOMEDRIVE !== undefined && process.env.HOMEPATH !== undefined
      ? join(process.env.HOMEDRIVE, process.env.HOMEPATH)
      : app.getPath('home'))
  return process.env.DSH_HOME || join(userHome, '.dsh')
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

/** Identify the Electron desktop shell to the Web renderer's plugin layer. */
function withDesktopShellParams(url: URL): URL {
  const next = new URL(url.toString())
  next.searchParams.set('dsh-desktop-mode', 'advanced')
  next.searchParams.set('dsh-desktop-platform', process.platform)
  const disabled = [...disabledBuiltinIds()]
  if (disabled.length > 0) next.searchParams.set('dsh-disabled', disabled.join(','))
  return next
}

// Built-in plugins whose only surface is a host-side registration (no
// renderer `./client` entry). Disabling one from the manager therefore needs
// a host restart with its cordis insert dropped from the runtime patch.
const BUILTIN_HOST_ONLY_IDS: ReadonlySet<string> = new Set(['dsh-commandcode-provider'])
const DISABLED_UI_STATE_PREFIX = 'dsh.builtin.'
const DISABLED_UI_STATE_SUFFIX = '.enabled'

/** Built-in plugin ids switched off in Settings → 内置插件 (persisted UI-state). */
function disabledBuiltinIds(): Set<string> {
  const disabled = new Set<string>()
  try {
    const text = readFileSync(join(app.getPath('userData'), UI_STATE_FILE), 'utf8')
    const parsed = JSON.parse(text) as Record<string, unknown>
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== '0') continue
      if (!key.startsWith(DISABLED_UI_STATE_PREFIX) || !key.endsWith(DISABLED_UI_STATE_SUFFIX)) continue
      const id = key.slice(DISABLED_UI_STATE_PREFIX.length, key.length - DISABLED_UI_STATE_SUFFIX.length)
      if (id.length > 0) disabled.add(id)
    }
  } catch {
    /* ui-state not written yet — nothing disabled */
  }
  return disabled
}

/**
 * Drop cordis `- insert:` blocks whose plugin id is disabled and host-only.
 * Returns undefined when nothing needs removing (caller keeps the original
 * patch file). Blocks are top-level YAML items: a block starts at a column-0
 * line and runs until the next column-0 line.
 */
async function filteredRuntimePatchForDisabled(originalPath: string): Promise<string> {
  const hostOnlyDisabled = [...disabledBuiltinIds()].filter(id => BUILTIN_HOST_ONLY_IDS.has(id))
  if (hostOnlyDisabled.length === 0) return originalPath
  let text: string
  try {
    text = await readFile(originalPath, 'utf8')
  } catch {
    return originalPath
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const blocks: string[][] = []
  let current: string[] = []
  let started = false
  for (const line of lines) {
    const isTopLevel = line === '' || !/^[ \t]/.test(line)
    if (isTopLevel && started) {
      blocks.push(current)
      current = []
    }
    current.push(line)
    started = true
  }
  if (current.length > 0) blocks.push(current)
  const kept = blocks.filter(block => {
    if (!/^- insert:/.test(block[0] ?? '')) return true
    return !hostOnlyDisabled.some(id => block.some(line => line.trim() === `name: ${id}`))
  })
  if (kept.length === blocks.length) return originalPath
  const output = `${originalPath}.disabled.yml`
  await writeFile(output, kept.join(eol), 'utf8')
  return output
}

async function loadHostPage(window: BrowserWindow, url: URL): Promise<void> {
  const desktopUrl = withDesktopShellParams(url)
  let lastError: unknown
  for (let attempt = 1; attempt <= HOST_LOAD_ATTEMPTS; attempt += 1) {
    try {
      await waitForHost(url, HOST_REQUEST_TIMEOUT_MS)
      await window.loadURL(desktopUrl.toString())
      return
    } catch (error) {
      lastError = error
      console.warn(`desktop: Web renderer load attempt ${String(attempt)} failed for ${desktopUrl.toString()}: ${String(error)}`)
      if (attempt < HOST_LOAD_ATTEMPTS) {
        await new Promise<void>((resolve) => { setTimeout(resolve, HOST_LOAD_RETRY_DELAY_MS) })
      }
    }
  }
  throw new Error(`desktop: failed to load the Web renderer at ${desktopUrl.toString()}: ${String(lastError)}`)
}

async function resolveHostEntry(): Promise<string> {
  const explicitEntry = process.env.DSH_DESKTOP_HOST_PATH
  if (!app.isPackaged) {
    return resolveDevelopmentHostEntry(app.getAppPath(), explicitEntry)
  }

  const pointer = await readPackagedSourceHostPointer()
  const packagedRoot = process.env.DSH_DESKTOP_SOURCE_ROOT
    ?? (isAbsolute(pointer.sourceRoot) ? pointer.sourceRoot : resolve(process.resourcesPath, pointer.sourceRoot))
  const sourceEntry = explicitEntry ?? resolve(packagedRoot, pointer.hostEntry)
  if (!existsSync(sourceEntry)) {
    throw new Error(`desktop: original source host is missing at ${sourceEntry}; set DSH_DESKTOP_SOURCE_ROOT or DSH_DESKTOP_HOST_PATH`)
  }
  return sourceEntry
}

interface SourceHostPointer {
  version: 1 | 2
  sourceRoot: string
  hostEntry: string
}

async function readPackagedSourceHostPointer(): Promise<SourceHostPointer> {
  const path = join(process.resourcesPath, HOST_ROOT_FILE)
  let value: unknown
  try {
    value = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`desktop: cannot read source host pointer ${path}: ${String(error)}`)
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('desktop: packaged source host pointer is invalid')
  }
  const pointer = value as Partial<SourceHostPointer>
  const hostEntry = pointer.hostEntry
  if (![1, 2].includes(pointer.version ?? 0) || typeof pointer.sourceRoot !== 'string' || typeof hostEntry !== 'string' || ![SOURCE_HOST_ENTRY, PACKAGED_HOST_ENTRY, OFFICIAL_PACKAGE_HOST_ENTRY].includes(hostEntry)) {
    throw new Error('desktop: packaged source host pointer is invalid')
  }
  const sourceRoot = process.env.DSH_DESKTOP_SOURCE_ROOT
    ?? (isAbsolute(pointer.sourceRoot) ? pointer.sourceRoot : resolve(process.resourcesPath, pointer.sourceRoot))
  const entry = resolve(sourceRoot, hostEntry)
  const local = relative(sourceRoot, entry)
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error('desktop: packaged source host entry escapes its source root')
  }
  return pointer as SourceHostPointer
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
      color: '#00000000',
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
    title: `${PRODUCT_TITLE}${currentUpstreamVersion() === '' ? '' : ` v${currentUpstreamVersion()}`}`,
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
      color: '#00000000',
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
  // Begin streaming diagnostics buffer updates to the just-created window.
  setBroadcastTarget(window)
  await loadHostPage(window, hostUrl)
  installBuiltinPluginWatcher(window)
}

/**
 * Product built-in plugins live in the writable `plugins/builtin` directory
 * (or `DSH_BUILTIN_PLUGINS_DIR`). The embedded host serves each plugin's
 * client bundle with a start-up content cache, so a plugin edit reaches the
 * renderer only after the host restarts. Watching that directory and
 * restarting just the host child process gives a no-repack, no-app-restart
 * plugin iteration loop: edit a plugin file, and a few seconds later the
 * window reloads against the updated host.
 */
function builtinPluginsWatchRoot(): string | undefined {
  const override = process.env.DSH_BUILTIN_PLUGINS_DIR
  if (override !== undefined && override !== '') return override
  const candidate = join(productRoot(), 'plugins', 'builtin')
  if (!existsSync(candidate)) return undefined
  console.error(`desktop: watching builtin plugins at ${candidate}`)
  return candidate
}

let pluginRestartBusy = false
let pluginRestartPending = false

function installBuiltinPluginWatcher(window: BrowserWindow): void {
  const pluginsRoot = builtinPluginsWatchRoot()
  if (pluginsRoot === undefined || !existsSync(pluginsRoot)) return
  let timer: NodeJS.Timeout | undefined
  const scheduleRestart = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => { console.error('desktop: builtin plugin change -> restarting host'); void restartHostForPluginChange(window) }, 800)
  }
  try {
    const watcher = watch(pluginsRoot, { recursive: true }, (_event, filename) => {
      if (typeof filename !== 'string') return
      if (!/\.(js|mjs|cjs|json)$/u.test(filename)) return
      console.error(`desktop: builtin plugin file change: ${filename}`)
      scheduleRestart()
    })
    watcher.on('error', error => { console.error(`desktop: builtin plugin watcher error: ${String(error)}`) })
  } catch (error) {
    console.error(`desktop: failed to watch builtin plugins at ${pluginsRoot}: ${String(error)}`)
  }
}

async function restartHostForPluginChange(window: BrowserWindow): Promise<void> {
  if (quitting || host === undefined) return
  // Serialize restarts: host changes during a restart are coalesced into one
  // follow-up restart instead of spawning concurrent hosts that kill each
  // other with SIGTERM.
  if (pluginRestartBusy) {
    pluginRestartPending = true
    return
  }
  pluginRestartBusy = true
  try {
    do {
      pluginRestartPending = false
      const previous = host
      host = undefined
      try {
        await previous.stop()
      } catch (error) {
        console.error(`desktop: plugin restart: host stop failed: ${String(error)}`)
      }
      const next = new DshHost()
      host = next
      try {
        hostUrl = await next.start()
        await loadHostPage(window, hostUrl)
      } catch (error) {
        console.error(`desktop: plugin restart: host restart failed: ${String(error)}`)
        handleStartupError(error)
        return
      }
    } while (pluginRestartPending)
  } finally {
    pluginRestartBusy = false
  }
}

function isDesktopSender(senderId: number): boolean {
  return mainWindow !== undefined && senderId === mainWindow.webContents.id
}

ipcMain.on(DESKTOP_IPC.titleBarColors, (event, value: unknown) => {
  if (mainWindow === undefined || event.sender.id !== mainWindow.webContents.id) return
  if (typeof value !== 'object' || value === null) return
  const colors = value as Partial<DesktopThemeColors>
  if (!isCssColor(colors.background) || !isCssColor(colors.foreground) || typeof colors.isDark !== 'boolean') return
  applyTitleBarColors({ background: colors.background, foreground: colors.foreground, isDark: colors.isDark })
})

ipcMain.on(DESKTOP_IPC.currentUpstreamVersion, (event) => {
  event.returnValue = currentUpstreamVersion()
})

ipcMain.on(DESKTOP_IPC.openUpdate, (event) => {
  if (mainWindow === undefined || event.sender.id !== mainWindow.webContents.id) return
  void shell.openExternal(PRODUCT_UPDATE_URL)
})

ipcMain.handle(DESKTOP_IPC.listVersions, async (event): Promise<DesktopVersionInfo[]> => {
  if (!isDesktopSender(event.sender.id)) return []
  return (await listVersionCandidates()).map(({ executablePath: _executablePath, downloadUrl: _downloadUrl, ...version }) => version)
})

ipcMain.handle(DESKTOP_IPC.switchVersion, async (event, value: unknown): Promise<void> => {
  if (!isDesktopSender(event.sender.id)) throw new Error('desktop: invalid version caller')
  await switchVersion(value as string)
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

// Namespaced UI-state persistence (stable across host port changes, unlike
// renderer localStorage which is keyed by origin and loses data when the
// local host port rotates between launches).
const UI_STATE_FILE = 'ui-state.json'
const UI_STATE_NAMESPACE_RE = /^[a-zA-Z0-9._-]{1,64}$/
ipcMain.handle(DESKTOP_IPC.readUiState, async (_event, key: unknown): Promise<string | null> => {
  if (typeof key !== 'string' || !UI_STATE_NAMESPACE_RE.test(key)) return null
  try {
    const text = await readFile(join(app.getPath('userData'), UI_STATE_FILE), 'utf8')
    const parsed = JSON.parse(text) as Record<string, unknown>
    const value = parsed[key]
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
})
ipcMain.handle(DESKTOP_IPC.writeUiState, async (_event, key: unknown, value: unknown): Promise<void> => {
  if (typeof key !== 'string' || !UI_STATE_NAMESPACE_RE.test(key)) return
  if (typeof value !== 'string' && value !== null) return
  const file = join(app.getPath('userData'), UI_STATE_FILE)
  try {
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    } catch {
      /* first write — start empty */
    }
    if (value === null) delete parsed[key]
    else parsed[key] = value
    await writeFile(file, JSON.stringify(parsed), 'utf8')
  } catch {
    /* persistence failure is non-fatal */
  }
})

// Built-in plugin manager: reload the host page without restarting the host
// process (same origin/port, so renderer-local gates re-evaluate instantly),
// or restart the host entirely for host-only built-ins and plugin file edits.
ipcMain.on(DESKTOP_IPC.reloadHostPage, (event) => {
  if (mainWindow === undefined || event.sender.id !== mainWindow.webContents.id) return
  if (host === undefined || hostUrl === undefined) return
  console.error('desktop: builtin manager requested host-page reload')
  void loadHostPage(mainWindow, hostUrl).catch(handleStartupError)
})
ipcMain.on(DESKTOP_IPC.restartHost, (event) => {
  if (mainWindow === undefined || event.sender.id !== mainWindow.webContents.id) return
  if (host === undefined) return
  console.error('desktop: builtin manager requested host restart')
  void restartHostForPluginChange(mainWindow).catch(handleStartupError)
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
  try {
    writeFileSync(join(app.getPath('userData'), 'startup-error.log'), inspect(error, { depth: Infinity, colors: false }), 'utf8')
    writeFileSync(join(process.cwd(), 'startup-error.log'), inspect(error, { depth: Infinity, colors: false }), 'utf8')
  } catch {
    // The error dialog remains the fallback when the user-data directory is unavailable.
  }
  dialog.showErrorBox('DeepSeek Harness', reason)
  app.quit()
}
