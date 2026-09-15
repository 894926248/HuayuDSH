#!/usr/bin/env node
/**
 * Built-in plugin manager — clean-environment end-to-end verification.
 *
 * Drives the real unpacked desktop app over the Chrome DevTools Protocol and
 * asserts the R37 on/off wiring inside the actual renderer:
 *
 *   1. default boot         — peak-valley sidebar footer (.dsh-pv-footer) is mounted
 *   2. localStorage '0'     — toggle OFF path: after reload the footer is gone
 *   3. localStorage '1'     — toggle ON path: footer is back (even if a stale
 *                             dsh-disabled shell param were present — not set here)
 *   4. dsh-disabled param   — shell restart path: key removed + ?dsh-disabled=…
 *                             in the URL → footer absent (param channel works)
 *
 * Why this exists: the agent sandbox cannot spawn GUI browsers (agent-browser
 * SIGTERM, unpacked exe silent-exit without an interactive desktop), so this
 * is the one remaining step — run it on a clean desktop session:
 *
 *   powershell -ExecutionPolicy Bypass -File <this-as-.ps1>   (or:)
 *   node product/tools/verify-builtin-manager-e2e.mjs
 *
 * The app is launched fresh with DSH_DEBUG_CDP=1 and terminated at the end.
 * Abort if an instance of "DeepSeek Harness.exe" is already running (the app
 * is single-instance and would silently exit).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXE = process.env.DSH_E2E_EXE
  ?? join(repo, '.workspace', 'artifacts', 'staging', 'desktop', 'win-unpacked', 'DeepSeek Harness.exe')
const CDP_PORT = 9222
const CDP_HTTP = `http://127.0.0.1:${CDP_PORT}`
const PLUGIN = 'dsh-peak-valley'
const LOCAL_KEY = `dsh.builtin.${PLUGIN}.enabled`
const FOOTER_SEL = '.dsh-pv-footer'
const BOOT_MIN_CHILDREN = 3

let failures = 0
const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

// --- minimal CDP client (Node >=22: global fetch + WebSocket) ---
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let seq = 0
    ws.onopen = () => {
      const send = (method, params = {}) => new Promise((res, rej) => {
        const id = ++seq
        pending.set(id, { res, rej })
        ws.send(JSON.stringify({ id, method, params }))
      })
      resolve({ ws, send })
    }
    ws.onerror = error => reject(new Error(`CDP websocket error: ${String(error)}`))
    ws.onmessage = event => {
      const msg = JSON.parse(String(event.data))
      if (!msg.id) return
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      if (msg.error) entry.rej(new Error(`CDP ${msg.error.message}`))
      else entry.res(msg.result)
    }
    ws.onclose = () => {
      for (const { rej } of pending.values()) rej(new Error('CDP closed'))
    }
  })
}

async function waitForCdpTarget(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`${CDP_HTTP}/json/list`)).json()
      const page = (list ?? []).find(t => t.type === 'page' && t.webSocketDebuggerUrl
        && (t.url.startsWith('http://127.0.0.1') || t.url.startsWith('http://localhost')))
      if (page) return page
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(`CDP target did not appear on ${CDP_HTTP}/json/list within ${timeoutMs / 1000}s`)
}

async function runE2E() {
  if (!existsSync(EXE)) throw new Error(`unpacked exe not found: ${EXE}`)
  const child = spawn(EXE, [], {
    env: { ...process.env, DSH_DEBUG_CDP: '1' },
    detached: false,
    stdio: 'ignore',
  })
  const exitEarly = new Promise((_, reject) => {
    child.once('exit', (code, signal) => reject(
      new Error(`app exited early (code ${String(code)} signal ${String(signal) ?? 'none'}) — is another instance running?`)))
  })
  let cdp
  try {
    const target = await Promise.race([waitForCdpTarget(), exitEarly])
    cdp = await connect(target.webSocketDebuggerUrl)
    const { send } = cdp
    await send('Runtime.enable')
    await send('Page.enable')

    const evaluate = async expression => {
      const out = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (out.exceptionDetails) {
        const text = out.exceptionDetails.exception?.description ?? out.exceptionDetails.text ?? 'unknown'
        throw new Error(`evaluate failed: ${text}`)
      }
      return out.result?.value
    }
    const waitUntil = async (expr, timeoutMs, what) => {
      const deadline = Date.now() + timeoutMs
      let last = null
      while (Date.now() < deadline) {
        try {
          last = await evaluate(expr)
          if (last) return true
        } catch { /* context reloading */ }
        await new Promise(r => setTimeout(r, 700))
      }
      return false
    }
    const footerPresent = async () => evaluate(`!!document.querySelector('${FOOTER_SEL}')`)
    const appMounted = `document.body && document.body.children.length >= ${BOOT_MIN_CHILDREN}`
    const reload = async () => { await evaluate('location.reload()') }
    // After reload the CDP context resets; these probes re-create it on demand.

    // 1. default boot: footer mounted
    await waitUntil(appMounted, 90_000, 'app boot')
    const onByDefault = await waitUntil(`!!document.querySelector('${FOOTER_SEL}')`, 30_000, 'peak-valley footer')
    record(`default boot mounts ${PLUGIN} footer`, onByDefault === true)

    // 2. toggle OFF via manager's localStorage channel
    await evaluate(`localStorage.setItem(${JSON.stringify(LOCAL_KEY)}, '0')`)
    await reload()
    await waitUntil(appMounted, 60_000, 'app boot after off-reload')
    const offState = await waitUntil(`!document.querySelector('${FOOTER_SEL}')`, 30_000, 'footer absent after off')
    record(`localStorage '0' disables ${PLUGIN} (footer gone)`, offState === true)

    // 3. toggle ON again
    await evaluate(`localStorage.setItem(${JSON.stringify(LOCAL_KEY)}, '1')`)
    await reload()
    await waitUntil(appMounted, 60_000, 'app boot after on-reload')
    const onAgain = await waitUntil(`!!document.querySelector('${FOOTER_SEL}')`, 30_000, 'peak-valley footer back')
    record(`localStorage '1' re-enables ${PLUGIN} (footer back)`, onAgain === true)

    // 4. shell restart channel: no local value + ?dsh-disabled=<id> in URL
    await evaluate(`localStorage.removeItem(${JSON.stringify(LOCAL_KEY)})`)
    const current = await evaluate('location.href')
    const url = new URL(current)
    url.searchParams.set('dsh-disabled', PLUGIN)
    await send('Page.navigate', { url: url.toString() })
    await waitUntil(appMounted, 60_000, 'app boot after param navigate')
    const paramOff = await waitUntil(`!document.querySelector('${FOOTER_SEL}')`, 30_000, 'footer absent under dsh-disabled param')
    record(`dsh-disabled param disables ${PLUGIN} (footer gone)`, paramOff === true)

    // restore clean local state
    try { await evaluate(`localStorage.removeItem(${JSON.stringify(LOCAL_KEY)})`) } catch { /* ignore */ }
  } finally {
    try { cdp?.ws.close() } catch { /* ignore */ }
    if (child.exitCode === null) child.kill()
  }
}

runE2E()
  .then(() => {
    console.log(failures === 0 ? '\nBUILTIN-MANAGER-E2E: ALL PASS' : `\nBUILTIN-MANAGER-E2E: ${failures} FAILURES`)
    process.exit(failures === 0 ? 0 : 1)
  })
  .catch(error => {
    console.error(`\nBUILTIN-MANAGER-E2E: ERROR ${error.message}`)
    process.exit(2)
  })
