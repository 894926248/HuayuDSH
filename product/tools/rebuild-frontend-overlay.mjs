import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { readUpstreamRelease } from './upstream-release.mjs'

const root = resolve(import.meta.dirname, '../..')
const upstreamRoot = resolve(root, 'upstream')
const sourceRoot = resolve(root, 'product/app/frontend/source')
const manifestPath = resolve(root, 'product/config/overlay-manifest.json')

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function isInside(parent, candidate) {
  const value = relative(parent, candidate)
  return value !== '' && value !== '..' && !value.startsWith('..\\') && !value.startsWith('../') && !value.startsWith('\\') && !value.startsWith('/')
}

function readOfficialFile(commit, path) {
  return execFileSync('git', ['-C', upstreamRoot, 'show', `${commit}:${path}`], { encoding: 'buffer' })
}

function mergeThreeWay(oursPath, basePath, theirsPath) {
  const result = spawnSync('git', [
    'merge-file',
    '--diff3',
    '--stdout',
    oursPath,
    basePath,
    theirsPath,
  ], { windowsHide: true })
  if (result.error !== undefined) throw result.error
  if (result.status === 0) return { content: result.stdout, conflict: false }
  if (result.status !== 1) {
    throw new Error(`git merge-file failed for ${relative(root, oursPath)}: ${String(result.stderr)}`)
  }

  const oursResult = spawnSync('git', [
    'merge-file',
    '--ours',
    '--diff3',
    '--stdout',
    oursPath,
    basePath,
    theirsPath,
  ], { windowsHide: true })
  if (oursResult.error !== undefined) throw oursResult.error
  if (oursResult.status !== 0) {
    throw new Error(`git merge-file could not preserve ours for ${relative(root, oursPath)}: ${String(oursResult.stderr)}`)
  }
  return { content: oursResult.stdout, conflict: true }
}

async function mergeOverlayFile(path, previousCommit) {
  const destination = resolve(sourceRoot, path)
  if (!isInside(sourceRoot, destination)) throw new Error(`overlay path escapes its source root: ${path}`)
  if (!existsSync(destination)) throw new Error(`frontend overlay source is missing: ${destination}`)

  const ours = await readFile(destination)
  const base = readOfficialFile(previousCommit, path)
  let theirs
  try {
    theirs = await readFile(resolve(upstreamRoot, path))
  } catch {
    throw new Error(`upstream UI target was removed or renamed; review manually: ${path}`)
  }

  if (ours.equals(base)) return { content: theirs, conflict: false }
  if (theirs.equals(base)) return { content: ours, conflict: false }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-frontend-merge-'))
  const oursPath = join(temporaryRoot, 'ours')
  const basePath = join(temporaryRoot, 'base')
  const theirsPath = join(temporaryRoot, 'theirs')
  try {
    await writeFile(oursPath, ours)
    await writeFile(basePath, base)
    await writeFile(theirsPath, theirs)
    return mergeThreeWay(oursPath, basePath, theirsPath)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const upstream = readUpstreamRelease(root)
const status = git(upstreamRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
if (status !== '') throw new Error(`pinned upstream worktree is dirty:\n${status}`)
if (manifest.schema !== 'dsh.product-overlay-manifest.v3' || manifest.backendPolicy !== 'upstream-only' || !Array.isArray(manifest.files)) {
  throw new Error('frontend overlay manifest is invalid')
}

const previousCommit = manifest.sourceCommit
const conflicts = []
if (previousCommit !== upstream.commit) {
  for (const row of manifest.files) {
    if (row?.layer !== 'frontend' || typeof row.path !== 'string') throw new Error(`invalid frontend overlay row: ${JSON.stringify(row)}`)
    const result = await mergeOverlayFile(row.path, previousCommit)
    await writeFile(resolve(sourceRoot, row.path), result.content)
    if (result.conflict) conflicts.push({ path: row.path, resolution: 'ours' })
  }
  console.log(`frontend overlay: three-way sync ${previousCommit} -> ${upstream.commit}`)
} else {
  console.log(`frontend overlay: refreshed at ${upstream.commit}`)
}

for (const row of manifest.files) {
  const path = resolve(sourceRoot, row.path)
  if (!existsSync(path)) throw new Error(`frontend product source is missing: ${path}`)
  row.sha256 = digest(await readFile(path))
}

manifest.schema = 'dsh.product-overlay-manifest.v3'
manifest.sourceCommit = upstream.commit
manifest.merge = {
  baseCommit: previousCommit,
  conflictPolicy: 'ours-and-report',
  conflicts,
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`frontend overlay: indexed ${String(manifest.files.length)} UI files`)
console.log(`frontend overlay: ${relative(root, manifestPath)}`)
if (conflicts.length > 0) {
  console.warn(`frontend overlay: ${String(conflicts.length)} conflict(s) preserved product code; review product/config/overlay-manifest.json`)
}
