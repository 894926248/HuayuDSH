import { app, ipcMain, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Cap on retained error entries; older rows are dropped FIFO to keep the file small. */
const MAX_RETAINED_ENTRIES = 100

/** Snapshot of a single captured error. Stored verbatim and also pushed to the renderer. */
export interface LastError {
  /** Unix epoch ms when the row was captured. */
  time: number
  /** Compact error class — "console" / "uncaught" / "render-failed" / "recovery" / "host". */
  kind: string
  /** stderr/stdout line (verbatim text the desktop shell forwarded). May span multiple lines. */
  message: string
  /** Soft extra fields captured opportunistically; never required by the renderer. */
  context?: Record<string, unknown>
}

let captureEnabled = false

/** Errors captured in the current process lifetime; flushed to disk on demand. */
const live: LastError[] = []

let diagnosticsDirReady = false

/** Resolve the JSONL store path under the per-user appData directory. */
function diagnosticsFile(): string {
  const dir = join(app.getPath('userData'), 'diagnostics')
  if (!diagnosticsDirReady) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    diagnosticsDirReady = true
  }
  return join(dir, 'last-errors.json')
}

/** Shape persisted to disk — the live array plus metadata so the renderer can hydrate on boot. */
interface LastErrorsDocument {
  /** ISO timestamp when the document was last rewritten. */
  updatedAt: string
  /** Captured errors, newest last. */
  entries: LastError[]
}

/** Push a single captured error to the in-memory ring buffer + flush to disk. */
export function captureLastError(entry: LastError): void {
  if (!captureEnabled) return
  live.push(entry)
  while (live.length > MAX_RETAINED_ENTRIES) live.shift()
  void flushToDisk()
}

/**
 * Record a chunk from the spawned host profile's stdio. stderr is the primary
 * signal (errors, LLM failures, recovery logs); stdout is captured too (with
 * its own kind) so boot timing and the session-recovery completion signal can
 * be inspected without burying real failures.
 * @param kind - which host stream produced the chunk.
 * @param chunk - the raw data the host profile emitted.
 */
export function captureHostOutput(kind: 'stdout' | 'stderr', chunk: Buffer | string): void {
  if (!captureEnabled) return
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  for (const line of text.split(/\r?\n/u)) {
    if (line.trim() === '') continue
    captureLastError({ time: Date.now(), kind: kind === 'stdout' ? 'host-stdout' : 'host-stderr', message: line })
  }
}

/** Flush `live` to the diagnostics JSON file. Best-effort: never throws. */
export function flushToDisk(): void {
  if (!captureEnabled) return
  try {
    const document: LastErrorsDocument = {
      updatedAt: new Date().toISOString(),
      entries: live.slice(),
    }
    const path = diagnosticsFile()
    const temporary = `${path}.tmp-${process.pid}`
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    renameSync(temporary, path)
  } catch (error) {
    // Diagnostics is a best-effort optimization; never fail the host path because the disk is full.
    void error
  }
}

/** Read whatever is on disk and merge anything not yet persisted into it. */
export function readLastErrors(): { updatedAt: string; entries: LastError[] } {
  flushToDisk()
  try {
    const path = diagnosticsFile()
    if (!existsSync(path)) return { updatedAt: '', entries: live.slice() }
    const raw = readFileSync(path, 'utf8')
    const document = JSON.parse(raw) as LastErrorsDocument
    // Merge: live may hold entries newer than the last flush (window between flushes).
    const seen = new Set(document.entries.map(entry => `${entry.time}|${entry.message}`))
    const merged = document.entries.slice()
    for (const entry of live) {
      const key = `${entry.time}|${entry.message}`
      if (!seen.has(key)) merged.push(entry)
    }
    return { updatedAt: document.updatedAt, entries: merged }
  } catch {
    return { updatedAt: '', entries: live.slice() }
  }
}

/** Holder for the main BrowserWindow so the capture module can push live updates without a circular import. */
// broadcastTarget replaces activeWindow; live stream is a module-local ring buffer.

/** Hold the main BrowserWindow so capture updates can be streamed to the renderer. */
let broadcastTarget: BrowserWindow | undefined

/**
 * Push the most recent captured errors to the renderer for instant UI updates.
 * @param window - BrowserWindow whose webContents receives the channel.
 */
export function broadcastLastErrors(window: BrowserWindow | undefined = broadcastTarget): void {
  if (window === undefined || window.isDestroyed()) return
  flushToDisk()
  window.webContents.send('dsh:last-errors', { updatedAt: new Date().toISOString(), entries: live.slice() })
}

/**
 * Begin forwarding host stderr/stdout lines into the diagnostics buffer. Idempotent.
 * Safe to call from anywhere in the main process bootstrap path.
 */
export function installConsoleForwarding(): void {
  captureEnabled = true
  tapProcessStreams()
  registerIpcHandlers()
}

/** Hook process.stdout/stderr so console.* lines land in the diagnostics buffer. */
function tapProcessStreams(): void {
  const tap = (stream: NodeJS.WritableStream, kind: 'stdout' | 'stderr'): void => {
    const originalWrite = stream.write.bind(stream) as NodeJS.WritableStream['write']
    stream.write = (chunk: Buffer | string, ...rest: unknown[]): boolean => {
      try {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        for (const line of text.split(/\r?\n/u)) {
          if (line.trim() === '') continue
          captureLastError({ time: Date.now(), kind: `console-${kind}`, message: line })
        }
      } finally {
        // Forward the original write regardless, so the shell's diagnostics file remains intact.
        const result = originalWrite(chunk, ...(rest as [])) as unknown as boolean
        return result
      }
    }
  }
  tap(process.stdout, 'stdout')
  tap(process.stderr, 'stderr')
}

/** Wire the two IPC channels exposed to the renderer (`dsh:get-last-errors`, `dsh:last-errors`). */
function registerIpcHandlers(): void {
  ipcMain.handle('dsh:get-last-errors', () => readLastErrors())
  ipcMain.handle('dsh:last-errors-refresh', () => {
    flushToDisk()
    broadcastLastErrors()
    return readLastErrors()
  })
}

/** Aim future broadcasts at the freshly created main window. */
export function setBroadcastTarget(window: BrowserWindow): void {
  broadcastTarget = window
  broadcastLastErrors()
  window.on('closed', () => {
    if (broadcastTarget === window) broadcastTarget = undefined
  })
}

