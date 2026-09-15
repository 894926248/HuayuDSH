import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { readUpstreamRelease } from './upstream-release.mjs'

const root = resolve(import.meta.dirname, '../..')
const upstreamRoot = resolve(root, 'upstream')
const appRoot = resolve(root, 'product/app')
const overlayManifestPath = resolve(root, 'product/config/overlay-manifest.json')

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sourceFiles(directory, prefix = '') {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...sourceFiles(resolve(directory, entry.name), path))
    else if (entry.isFile()) files.push(path.replaceAll('\\', '/'))
  }
  return files
}

const errors = []
if (!existsSync(upstreamRoot)) errors.push(`upstream worktree is missing: ${upstreamRoot}`)
if (!existsSync(overlayManifestPath)) errors.push(`product overlay manifest is missing: ${overlayManifestPath}`)

if (errors.length === 0) {
  const manifest = readJson(overlayManifestPath)
  const upstream = readUpstreamRelease(root)
  const status = git(upstreamRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status !== '') errors.push(`upstream worktree is dirty:\n${status}`)
  if (manifest.schema !== 'dsh.product-overlay-manifest.v3' || manifest.backendPolicy !== 'upstream-only' || !Array.isArray(manifest.files)) {
    errors.push('product overlay manifest is invalid')
  }
  if (manifest.sourceCommit !== upstream.commit) {
    errors.push(`product overlay source commit mismatch: manifest=${String(manifest.sourceCommit)}, upstream=${upstream.commit}`)
  }
  const seen = new Set()
  const targetRoots = ['apps/web/', 'packages/client/']
  for (const row of manifest.files ?? []) {
    if (typeof row?.layer !== 'string' || typeof row?.path !== 'string' || typeof row?.sha256 !== 'string') {
      errors.push('every product overlay row needs layer, path, and sha256')
      continue
    }
    if (row.layer !== 'frontend') {
      errors.push(`backend/shared/tooling source overlay is forbidden: ${row.layer}/${row.path}`)
      continue
    }
    if (!targetRoots.some(prefix => row.path.startsWith(prefix))) {
      errors.push(`frontend overlay target is outside the WebUI plane: ${row.path}`)
    }
    if (seen.has(row.path)) errors.push(`product overlay path is listed more than once: ${row.path}`)
    seen.add(row.path)
    const path = resolve(appRoot, row.layer, 'source', row.path)
    if (!path.startsWith(appRoot + '\\') || !existsSync(path)) {
      errors.push(`product overlay source is missing or escapes its layer: ${row.layer}/${row.path}`)
      continue
    }
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (digest !== row.sha256) {
      errors.push(`product overlay hash mismatch: ${row.layer}/${row.path}`)
    }
  }
  if (existsSync(resolve(appRoot, 'frontend/source'))) {
    for (const path of sourceFiles(resolve(appRoot, 'frontend/source'))) {
      if (!seen.has(path)) errors.push(`frontend source file is not indexed: ${path}`)
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`product-source: ${error}`)
  process.exitCode = 1
} else {
  console.log(`product-source: ${readJson(overlayManifestPath).files.length} overlay files match ${readUpstreamRelease(root).tag}`)
}
