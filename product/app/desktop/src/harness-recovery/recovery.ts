import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

type JsonRecord = Record<string, unknown>

interface RecoveryBoundary {
  turn: number
  step?: number
  seq: number
}

type RecoveryStatus = 'pending' | 'submitting' | 'submitted' | 'exhausted'

interface RecoveryEntry {
  sessionId: string
  boundary: RecoveryBoundary
  fingerprint: string
  status: RecoveryStatus
  attempts: number
  updatedAt: number
  lastError?: string
}

interface RecoveryState {
  schema: 'dsh.harness-recovery-state.v1'
  sessions: Record<string, RecoveryEntry>
}

interface SessionEvent {
  type: string
  seq: number
  data: unknown
}

const STATE_SCHEMA = 'dsh.harness-recovery-state.v1' as const
const MAX_AUTOMATIC_RESUME_ATTEMPTS = 1
const MUX_RECONNECT_DELAY_MS = 1_000
const MUX_RECONNECT_BACKOFF_CAP_MS = 30_000
const MUX_RECONNECT_MAX_ATTEMPTS = 8
const RECOVERY_MESSAGE = [
  'The previous Harness turn was interrupted before it produced a terminal result.',
  'Continue from the durable session history.',
  'Do not repeat completed tool calls or side effects; inspect existing results and verify state before acting.',
].join('\n')

function object(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function emptyState(): RecoveryState {
  return { schema: STATE_SCHEMA, sessions: {} }
}

function validStatus(value: unknown): value is RecoveryStatus {
  return value === 'pending'
    || value === 'submitting'
    || value === 'submitted'
    || value === 'exhausted'
}

function recoveryEntry(value: unknown): RecoveryEntry | undefined {
  const row = object(value)
  const boundary = object(row?.boundary)
  const sessionId = row?.sessionId
  const fingerprint = row?.fingerprint
  const status = row?.status
  const attempts = integer(row?.attempts)
  const updatedAt = integer(row?.updatedAt)
  const turn = integer(boundary?.turn)
  const seq = integer(boundary?.seq)
  const step = boundary?.step === undefined ? undefined : integer(boundary.step)
  if (typeof sessionId !== 'string' || sessionId === ''
    || typeof fingerprint !== 'string' || fingerprint === ''
    || !validStatus(status) || attempts === undefined || attempts < 0
    || updatedAt === undefined || turn === undefined || turn < 0
    || seq === undefined || seq < 0 || (boundary?.step !== undefined && step === undefined)) {
    return undefined
  }
  return {
    sessionId,
    boundary: { turn, seq, ...(step === undefined ? {} : { step }) },
    fingerprint,
    status,
    attempts,
    updatedAt,
    ...(typeof row?.lastError === 'string' ? { lastError: row.lastError } : {}),
  }
}

async function readState(stateRoot: string): Promise<RecoveryState> {
  const path = join(stateRoot, 'harness-recovery-state.json')
  try {
    const value = object(JSON.parse(await readFile(path, 'utf8')))
    const sessions = object(value?.sessions)
    if (value?.schema !== STATE_SCHEMA || sessions === undefined) {
      throw new Error('invalid state schema')
    }
    const state = emptyState()
    for (const [sessionId, row] of Object.entries(sessions)) {
      const entry = recoveryEntry(row)
      if (entry !== undefined && entry.sessionId === sessionId) state.sessions[sessionId] = entry
    }
    return state
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
      console.warn(`desktop: Harness recovery state was reset: ${errorMessage(error)}`)
    }
    return emptyState()
  }
}

function eventFromHistoryEntry(value: unknown): SessionEvent | undefined {
  const entry = object(value)
  const event = object(entry?.event)
  const type = event?.type
  const seq = integer(event?.seq)
  if (event === undefined || typeof type !== 'string' || seq === undefined || seq < 0) return undefined
  return { type, seq, data: event.data }
}

function turnOf(event: SessionEvent): number | undefined {
  return integer(object(event.data)?.turn)
}

function stepOf(event: SessionEvent): number | undefined {
  return integer(object(event.data)?.step)
}

/** Return the last turn that has a durable start but no durable terminal event. */
export function interruptedTurnFromHistory(entries: readonly unknown[]): RecoveryBoundary | undefined {
  let open: RecoveryBoundary | undefined
  let openStep: number | undefined
  for (const value of entries) {
    const event = eventFromHistoryEntry(value)
    if (event === undefined) continue
    if (event.type === 'turn/start') {
      const turn = turnOf(event)
      if (turn !== undefined) {
        open = { turn, seq: event.seq }
        openStep = undefined
      }
      continue
    }
    if (open === undefined) continue
    if (event.type === 'step/start') {
      const step = stepOf(event)
      if (step !== undefined) openStep = step
    } else if (event.type === 'step/end') {
      openStep = undefined
    } else if (event.type === 'turn/end') {
      const turn = turnOf(event)
      if (turn === undefined || turn >= open.turn) {
        open = undefined
        openStep = undefined
      }
    }
  }
  if (open === undefined) return undefined
  return openStep === undefined ? open : { ...open, step: openStep }
}

export function recoveryFingerprint(sessionId: string, boundary: RecoveryBoundary): string {
  return createHash('sha256')
    .update(JSON.stringify({ sessionId, boundary }))
    .digest('hex')
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    function onAbort(): void {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

interface HarnessRecoveryOptions {
  /** Product-owned state directory; the official DSH home is never written. */
  stateRoot: string
}

/**
 * Product-owned recovery coordinator. It observes the official Host mux and
 * uses the official RPC surface; it has no child process or external runtime.
 */
export class HarnessRecovery {
  private stopped = true
  private hostUrl: URL | undefined
  private lifetime: AbortController | undefined
  private streamTask: Promise<void> | undefined
  private reconcileTask: Promise<void> = Promise.resolve()
  private state = emptyState()
  private stateWrite: Promise<void> = Promise.resolve()

  constructor(private readonly options: HarnessRecoveryOptions) {}

  async start(hostUrl: URL): Promise<void> {
    if (!this.stopped) return
    this.stopped = false
    this.hostUrl = new URL(hostUrl)
    const lifetime = new AbortController()
    this.lifetime = lifetime
    this.state = await readState(this.options.stateRoot)
    // Reconcile in the background. It only lists sessions and prunes the
    // recovery state — no history parsing — so it is cheap and does not
    // contend with the user's first clicks. resumePending awaits this task
    // when it needs the reconciled list, so recovery semantics are unchanged.
    this.reconcileTask = this.reconcile(lifetime.signal).catch(error => {
      if (!this.stopped) console.warn(`desktop: Harness recovery reconcile failed: ${errorMessage(error)}`)
    })
    if (this.stopped) return
    this.streamTask = this.consumeMux(lifetime.signal)
    await this.resumePending(lifetime.signal)
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.lifetime?.abort()
    const streamTask = this.streamTask
    this.streamTask = undefined
    this.lifetime = undefined
    const reconcileTask = this.reconcileTask
    this.reconcileTask = Promise.resolve()
    await reconcileTask.catch(() => undefined)
    this.hostUrl = undefined
    await streamTask?.catch(() => undefined)
    await this.stateWrite.catch(() => undefined)
  }

  private async persist(): Promise<void> {
    const path = join(this.options.stateRoot, 'harness-recovery-state.json')
    const temporary = `${path}.tmp-${process.pid}`
    const snapshot = `${JSON.stringify(this.state, null, 2)}\n`
    const operation = this.stateWrite.then(async () => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(temporary, snapshot, 'utf8')
      await rename(temporary, path)
    })
    this.stateWrite = operation.catch(error => {
      console.warn(`desktop: Harness recovery state write failed: ${errorMessage(error)}`)
    })
    await this.stateWrite
  }

  private async reconcile(signal: AbortSignal): Promise<void> {
    const listed = await this.call('session.list', {}, signal).catch(error => {
      if (!this.stopped) console.warn(`desktop: Harness recovery session list failed: ${errorMessage(error)}`)
      return undefined
    })
    const list = object(listed)
    const items = Array.isArray(list?.items) ? list.items : []
    const alive = new Set<string>()
    for (const item of items) {
      const summary = object(item)
      if (typeof summary?.sessionId !== 'string' || summary.sessionId === '') continue
      alive.add(summary.sessionId)
    }
    // Aligned with how OpenCode/Claude Code load conversation history: the
    // shell must NOT scan every session's history on boot. History parsing is
    // CPU-bound on the host (zstd decompress + JSONL), and doing it for all
    // sessions made the host unresponsive right when the user starts clicking.
    // We only (a) prune sessions that no longer exist and (b) resume pending
    // recoveries already recorded in state from a previous run — the state
    // file itself is authoritative for what was interrupted.
    let dirty = false
    for (const sessionId of Object.keys(this.state.sessions)) {
      if (this.stopped) return
      if (!alive.has(sessionId)) {
        delete this.state.sessions[sessionId]
        dirty = true
      }
    }
    if (dirty) await this.persist()
  }

  private async resumePending(signal: AbortSignal): Promise<void> {
    await this.reconcileTask
    const pending = Object.values(this.state.sessions)
      .filter(entry => entry.status === 'pending' && entry.attempts < MAX_AUTOMATIC_RESUME_ATTEMPTS)
    for (const entry of pending) {
      if (this.stopped) return
      const current = this.state.sessions[entry.sessionId]
      if (current === undefined || current.fingerprint !== entry.fingerprint) continue
      current.status = 'submitting'
      current.attempts += 1
      current.updatedAt = Date.now()
      await this.persist()
      try {
        const value = await this.call('session.prompt', {
          sessionId: entry.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: RECOVERY_MESSAGE }],
        }, signal, `harness-recovery-${entry.sessionId}-${entry.fingerprint.slice(0, 16)}`)
        if (object(value)?.accepted !== true) throw new Error('session.prompt did not accept the recovery message')
        const submitted = this.state.sessions[entry.sessionId]
        if (submitted?.fingerprint === entry.fingerprint) {
          submitted.status = 'submitted'
          submitted.updatedAt = Date.now()
          await this.persist()
        }
      } catch (error: unknown) {
        const failed = this.state.sessions[entry.sessionId]
        if (failed?.fingerprint === entry.fingerprint) {
          failed.status = 'exhausted'
          failed.lastError = errorMessage(error)
          failed.updatedAt = Date.now()
          await this.persist()
        }
        if (!this.stopped) {
          console.warn(`desktop: Harness recovery did not resume ${entry.sessionId}: ${errorMessage(error)}`)
        }
      }
    }
  }

  private async consumeMux(signal: AbortSignal): Promise<void> {
    let failures = 0
    while (!this.stopped && !signal.aborted) {
      try {
        const hostUrl = this.hostUrl
        if (hostUrl === undefined) throw new Error('Host URL is not available')
        const response = await fetch(new URL('/api/events.mux', hostUrl), {
          headers: { Accept: 'text/event-stream' },
          signal,
        })
        if (!response.ok || response.body === null) {
          throw new Error(`events.mux returned HTTP ${String(response.status)}`)
        }
        failures = 0
        await this.readSse(response, signal)
      } catch (error: unknown) {
        if (this.stopped || signal.aborted) return
        // Exponential backoff with a cap: a permanently unavailable mux (e.g.
        // HTTP 426 from a host that no longer serves the SSE endpoint) must
        // not hammer the host and the disk log once per second forever.
        failures += 1
        if (failures > MUX_RECONNECT_MAX_ATTEMPTS) {
          console.warn(`desktop: Harness recovery mux giving up after ${failures} failures: ${errorMessage(error)}`)
          return
        }
        console.warn(`desktop: Harness recovery mux disconnected: ${errorMessage(error)}`)
        const backoff = Math.min(MUX_RECONNECT_DELAY_MS * (2 ** (failures - 1)), MUX_RECONNECT_BACKOFF_CAP_MS)
        await abortableDelay(backoff, signal)
      }
    }
  }

  private async readSse(response: Response, signal: AbortSignal): Promise<void> {
    if (response.body === null) throw new Error('events.mux returned no body')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = chunk.split(/\r?\n/u)
            .filter(line => line.startsWith('data: '))
            .map(line => line.slice(6))
            .join('')
          if (data !== '') this.handleSseData(data)
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }

  private handleSseData(data: string): void {
    let envelope: JsonRecord | undefined
    try { envelope = object(JSON.parse(data)) } catch { return }
    if (envelope?.type !== 'server-request') return
    const frame = object(envelope.payload)
    if (frame?.type !== 'session/event' || typeof frame.sessionId !== 'string') return
    const event = object(frame.event)
    const type = event?.type
    const seq = integer(event?.seq)
    if (event === undefined || typeof type !== 'string' || seq === undefined) return
    this.applyLiveEvent(frame.sessionId, { type, seq, data: event.data })
  }

  private applyLiveEvent(sessionId: string, event: SessionEvent): void {
    const entry = this.state.sessions[sessionId]
    if (entry === undefined) return
    const turn = turnOf(event)
    if (event.type === 'turn/start' && turn !== undefined && turn > entry.boundary.turn) {
      delete this.state.sessions[sessionId]
      void this.persist()
      return
    }
    if (event.type === 'turn/end' && (turn === undefined || turn >= entry.boundary.turn)) {
      delete this.state.sessions[sessionId]
      void this.persist()
    }
  }

  private async call(
    method: string,
    payload: JsonRecord,
    signal: AbortSignal,
    rpcId = `harness-recovery-${method}-${randomUUID()}`,
  ): Promise<unknown> {
    const hostUrl = this.hostUrl
    if (hostUrl === undefined) throw new Error('Host URL is not available')
    const request = { type: 'client-request', rpcId, method, payload }
    const response = await fetch(new URL(`/api/${method}`, hostUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })
    let body: unknown
    try { body = await response.json() } catch { body = undefined }
    const envelope = object(body)
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
    if (envelope?.type !== 'server-response' || envelope.rpcId !== rpcId) {
      throw new Error(`invalid ${method} response envelope`)
    }
    const result = object(envelope.result)
    if (result?.ok !== true) {
      const error = object(result?.error)
      throw new Error(typeof error?.message === 'string' ? error.message : `${method} was rejected`)
    }
    return result.value
  }
}
