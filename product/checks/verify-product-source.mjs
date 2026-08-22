import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const upstreamRoot = resolve(root, 'upstream')
const overlayManifestPath = resolve(root, 'product/current/overlay-manifest.json')
const upstreamLockPath = resolve(root, 'product/manifests/upstream-lock.json')

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const errors = []
if (!existsSync(upstreamRoot)) errors.push(`upstream worktree is missing: ${upstreamRoot}`)
if (!existsSync(overlayManifestPath)) errors.push(`product overlay manifest is missing: ${overlayManifestPath}`)
if (!existsSync(upstreamLockPath)) errors.push(`upstream lock is missing: ${upstreamLockPath}`)

if (errors.length === 0) {
  const lock = readJson(upstreamLockPath)
  const manifest = readJson(overlayManifestPath)
  const actualCommit = git(upstreamRoot, ['rev-parse', 'HEAD'])
  const status = git(upstreamRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (lock.schema !== 'dsh.upstream-lock.v1' || typeof lock.commit !== 'string') errors.push('upstream lock is invalid')
  if (lock.commit !== actualCommit) errors.push(`upstream commit mismatch: lock=${lock.commit}, worktree=${actualCommit}`)
  if (status !== '') errors.push(`upstream worktree is dirty:\n${status}`)
  if (manifest.schema !== 'dsh.product-overlay-manifest.v2' || manifest.backendPolicy !== 'upstream-only' || !Array.isArray(manifest.files)) {
    errors.push('product overlay manifest is invalid')
  }
  if (manifest.sourceCommit !== actualCommit) {
    errors.push(`product overlay source commit mismatch: manifest=${String(manifest.sourceCommit)}, upstream=${actualCommit}`)
  }
  const seen = new Set()
  for (const row of manifest.files ?? []) {
    if (typeof row?.layer !== 'string' || typeof row?.path !== 'string' || typeof row?.sha256 !== 'string') {
      errors.push('every product overlay row needs layer, path, and sha256')
      continue
    }
    if (row.layer !== 'frontend') {
      errors.push(`backend/shared/tooling source overlay is forbidden: ${row.layer}/${row.path}`)
      continue
    }
    if (seen.has(row.path)) errors.push(`product overlay path is listed more than once: ${row.path}`)
    seen.add(row.path)
    const path = resolve(root, 'product/current', row.layer, 'source', row.path)
    if (!path.startsWith(resolve(root, 'product/current') + '\\') || !existsSync(path)) {
      errors.push(`product overlay source is missing or escapes its layer: ${row.layer}/${row.path}`)
      continue
    }
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (digest !== row.sha256) {
      errors.push(`product overlay hash mismatch: ${row.layer}/${row.path}`)
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`product-source: ${error}`)
  process.exitCode = 1
} else {
  console.log(`product-source: ${readJson(overlayManifestPath).files.length} overlay files match ${git(upstreamRoot, ['rev-parse', 'HEAD'])}`)
}
