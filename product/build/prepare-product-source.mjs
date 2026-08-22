import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const upstreamRoot = resolve(root, 'upstream')
const outputRoot = resolve(process.argv[2] ?? resolve(root, 'product/artifacts/staging/source'))
const lockPath = resolve(root, 'product/manifests/upstream-lock.json')
const overlayRoot = resolve(root, 'product/current')
const overlayManifestPath = resolve(overlayRoot, 'overlay-manifest.json')

function git(cwd, args, options = {}) {
  const result = execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', ...options })
  return typeof result === 'string' ? result.trim() : ''
}

function run(command, args, cwd) {
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command
  const invocation = process.platform === 'win32'
    ? { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', [executable, ...args].join(' ')] }
    : { file: executable, args }
  const result = spawnSync(invocation.file, invocation.args, {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
    env: { ...process.env, CI: 'true' },
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`)
}

async function removeWorktree() {
  if (!existsSync(outputRoot)) return
  try { git(upstreamRoot, ['worktree', 'remove', '--force', outputRoot], { stdio: 'ignore' }) } catch {}
  await rm(outputRoot, { recursive: true, force: true })
}

async function applyProductOverlay(outputRoot, manifest) {
  for (const row of manifest.files) {
    if (row?.layer !== 'frontend' || typeof row?.path !== 'string' || typeof row?.sha256 !== 'string') {
      throw new Error('product overlay manifest contains an invalid file row')
    }
    const source = resolve(overlayRoot, row.layer, 'source', row.path)
    const target = resolve(outputRoot, row.path)
    if (!source.startsWith(resolve(overlayRoot) + '\\') || !target.startsWith(resolve(outputRoot) + '\\')) {
      throw new Error(`product overlay path escapes its root: ${row.layer}/${row.path}`)
    }
    if (!existsSync(source)) throw new Error(`product overlay source is missing: ${source}`)
    const digest = createHash('sha256').update(await readFile(source)).digest('hex')
    if (digest !== row.sha256) throw new Error(`product overlay hash mismatch: ${row.layer}/${row.path}`)
    await mkdir(resolve(target, '..'), { recursive: true })
    await cp(source, target, { force: true })
  }
}

async function main() {
  const expected = JSON.parse(await readFile(lockPath, 'utf8'))
  const overlayManifest = JSON.parse(await readFile(overlayManifestPath, 'utf8'))
  const actual = git(upstreamRoot, ['rev-parse', 'HEAD'])
  const status = git(upstreamRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status !== '') throw new Error(`pinned upstream worktree is dirty:\n${status}`)
  if (expected.commit !== actual) throw new Error(`upstream lock mismatch: expected ${expected.commit}, found ${actual}`)

  await removeWorktree()
  await mkdir(resolve(outputRoot, '..'), { recursive: true })
  git(upstreamRoot, ['worktree', 'add', '--detach', outputRoot, actual], { stdio: 'inherit' })
  try {
    await applyProductOverlay(outputRoot, overlayManifest)
    run('pnpm', ['install', '--offline', '--no-frozen-lockfile', '--ignore-scripts'], outputRoot)
    console.log(`product source: ${outputRoot}`)
    console.log(`product source base: ${actual}`)
  } catch (error) {
    await removeWorktree()
    throw error
  }
}

await main()
