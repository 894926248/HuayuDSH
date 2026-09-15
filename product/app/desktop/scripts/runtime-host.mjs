import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const desktopRoot = resolve(import.meta.dirname, '..')
const defaultSourceRoot = resolve(desktopRoot, '..', '..', '..', 'upstream')
const buildRoot = join(desktopRoot, 'build')
const hostPointerPath = join(buildRoot, 'host-root.json')
const sourceHostEntry = join('apps', 'cli', 'lib', 'bin.js')
const packagedHostEntry = 'lib/bin.js'
const officialPackageHostEntry = join('@deepseek-ai', 'dsh', 'lib', 'bin.js')
const HOST_START_TIMEOUT_MS = 30_000
const HOST_OUTPUT_LIMIT = 8_192

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  options: { unpacked: { type: 'string' } },
  allowPositionals: true,
})
const command = positionals[0]

if (command === 'stage') await stage()
else if (command === 'verify') await verify(values.unpacked)
else throw new Error('usage: node scripts/runtime-host.mjs <stage|verify> [--unpacked <win-unpacked>]')

/** Write the packaged runtime pointer used by the Electron shell. */
async function stage() {
  const sourceRoot = resolve(process.env.DSH_DESKTOP_SOURCE_ROOT ?? defaultSourceRoot)
  const pointer = createPointer(sourceRoot, process.env.DSH_DESKTOP_PACKAGED_RUNTIME_ROOT)
  await assertHostEntry(pointer, 'source host', sourceRoot)
  await mkdir(buildRoot, { recursive: true })
  await writeFile(hostPointerPath, `${JSON.stringify(pointer, null, 2)}\n`)
  console.log(`desktop source host: ${pointer.sourceRoot}`)
}

/** Verify that the package points at, and can boot, the original source host. */
async function verify(unpacked) {
  const expected = await readPointer(hostPointerPath)
  const expectedRoot = process.env.DSH_DESKTOP_SOURCE_ROOT
    ?? (isAbsolute(expected.sourceRoot)
      ? expected.sourceRoot
      : (unpacked === undefined ? undefined : resolvePackagedRoot(expected, resolve(unpacked, 'resources'))))
  // When verifying an unpacked package, the authoritative runtime is the copy
  // under its resources directory. The staging runtime may be replaced by the
  // builder while this check runs, so do not require that transient path first.
  if (unpacked === undefined) await assertHostEntry(expected, 'source host', expectedRoot)

  if (unpacked !== undefined) {
    const packagedPointerPath = join(resolve(unpacked), 'resources', 'host-root.json')
    const [expectedText, packagedText] = await Promise.all([
      readFile(hostPointerPath, 'utf8'),
      readFile(packagedPointerPath, 'utf8'),
    ])
    if (expectedText !== packagedText) {
      throw new Error(`desktop: packaged source pointer differs from ${hostPointerPath}`)
    }
    const packagedRoot = resolvePackagedRoot(expected, resolve(unpacked, 'resources'))
    const packagedPointer = { ...expected, sourceRoot: packagedRoot }
    const legacyRecoveryRoot = join(resolve(unpacked, 'resources', 'runtime'), 'hermes-recovery')
    if (existsSync(legacyRecoveryRoot)) {
      throw new Error(`desktop: legacy recovery runtime remains under ${legacyRecoveryRoot}`)
    }
    await assertHostEntry(packagedPointer, 'packaged source host')
    const packagedHome = await mkdtemp(join(tmpdir(), 'dsh-desktop-packaged-host-'))
    try {
      await runHostDump(packagedPointer, packagedHome)
      await runHostSmoke(packagedPointer, packagedHome)
    } finally {
      await rm(packagedHome, { recursive: true, force: true })
    }
  }

  const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-host-'))
  try {
    await runHostDump({ ...expected, sourceRoot: expectedRoot ?? expected.sourceRoot }, home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
  console.log('desktop source host: original host boot verified')
}

function createPointer(sourceRoot, packagedRoot) {
  const hostEntry = existsSync(join(sourceRoot, officialPackageHostEntry))
    ? officialPackageHostEntry
    : (existsSync(join(sourceRoot, packagedHostEntry)) ? packagedHostEntry : sourceHostEntry)
  return {
    version: 2,
    sourceRoot: packagedRoot ?? sourceRoot,
    hostEntry,
  }
}

async function readPointer(path) {
  let value
  try {
    value = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`desktop: cannot read source host pointer ${path}: ${String(error)}`)
  }
  if (value === null || typeof value !== 'object') {
    throw new Error(`desktop: source host pointer ${path} is invalid`)
  }
  const pointer = value
  if (![1, 2].includes(pointer.version) || typeof pointer.sourceRoot !== 'string' || typeof pointer.hostEntry !== 'string') {
    throw new Error(`desktop: source host pointer ${path} is invalid`)
  }
  return pointer
}

async function assertHostEntry(pointer, label, sourceRootOverride) {
  const sourceRoot = sourceRootOverride ?? pointer.sourceRoot
  if (!isAbsolute(sourceRoot)) {
    throw new Error(`desktop: ${label} root must be absolute: ${JSON.stringify(sourceRoot)}`)
  }
  if (![sourceHostEntry, packagedHostEntry, officialPackageHostEntry].includes(pointer.hostEntry)) {
    throw new Error(`desktop: ${label} entry is invalid: ${JSON.stringify(pointer.hostEntry)}`)
  }
  const entry = resolve(sourceRoot, pointer.hostEntry)
  const local = relative(sourceRoot, entry)
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error(`desktop: ${label} entry escapes its source root`)
  }
  try {
    await access(entry)
  } catch {
    throw new Error(`desktop: ${label} entry is missing at ${entry}`)
  }
}

function resolvePackagedRoot(pointer, resourcesRoot) {
  return isAbsolute(pointer.sourceRoot)
    ? resolve(pointer.sourceRoot)
    : resolve(resourcesRoot, pointer.sourceRoot)
}

async function runHostDump(pointer, home) {
  const entry = resolve(pointer.sourceRoot, pointer.hostEntry)
  const executable = process.env.DSH_DESKTOP_NODE_EXECUTABLE ?? 'node'
  await new Promise((resolveDump, reject) => {
    const child = spawn(executable, ['--expose-internals', entry, '--profile', 'web', '--dump-config'], {
      cwd: pointer.sourceRoot,
      env: { ...process.env, DSH_DESKTOP: '1', DSH_HOME: home },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-8192) })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolveDump()
      else reject(new Error(`desktop: original host boot check failed with code ${String(code)}: ${stderr.trim()}`))
    })
  })
}

/** Start the packaged CLI against a blank profile and prove its Web host serves HTML. */
async function runHostSmoke(pointer, home) {
  const entry = resolve(pointer.sourceRoot, pointer.hostEntry)
  const executable = process.env.DSH_DESKTOP_NODE_EXECUTABLE ?? 'node'
  const child = spawn(executable, ['--expose-internals', entry, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
    cwd: pointer.sourceRoot,
    env: { ...process.env, DSH_DESKTOP: '1', DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  try {
    await waitForWebHost(child)
  } finally {
    await stopHost(child)
  }
}

function waitForWebHost(child) {
  return new Promise((resolveReady, rejectReady) => {
    let output = ''
    let probing = false
    let settled = false
    let timeout
    const settle = (callback, value) => {
      if (settled) return
      settled = true
      if (timeout !== undefined) clearTimeout(timeout)
      callback(value)
    }
    const append = (chunk) => {
      output = `${output}${chunk}`.slice(-HOST_OUTPUT_LIMIT)
      // Keep the announced URL verbatim, query string included: a host that
      // enforces its launch token answers 401 for the bare origin.
      const match = /\bdsh web:\s+(http:\/\/127\.0\.0\.1:\d+[^\s]*)/iu.exec(output)
      const url = match?.[1]
      if (url === undefined || probing) return
      probing = true
      void fetch(url).then(async response => {
        const document = await response.text()
        if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/html') || !document.includes('__DSH_BOOT__')) {
          throw new Error(`unexpected Web host response at ${url} (HTTP ${String(response.status)})`)
        }
        settle(resolveReady)
      }).catch(error => {
        settle(rejectReady, new Error(`desktop: packaged Web host probe failed: ${String(error)}\n${output.trim()}`))
      })
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', error => { settle(rejectReady, error) })
    child.once('exit', (code, signal) => {
      settle(rejectReady, new Error(`desktop: packaged Web host exited before readiness (code ${String(code)}, signal ${signal ?? 'none'}):\n${output.trim()}`))
    })
    timeout = setTimeout(() => {
      settle(rejectReady, new Error(`desktop: packaged Web host did not become ready:\n${output.trim()}`))
    }, HOST_START_TIMEOUT_MS)
  })
}

async function stopHost(child) {
  if (child.exitCode !== null) return
  await new Promise(resolveStopped => {
    const timeout = setTimeout(resolveStopped, 5_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolveStopped()
    })
    if (child.exitCode === null) child.kill()
    else {
      clearTimeout(timeout)
      resolveStopped()
    }
  })
}
