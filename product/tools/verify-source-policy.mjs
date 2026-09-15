import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const upstreamRoot = resolve(root, 'upstream')
const policyPath = resolve(root, 'product/config/source-policy.json')
const manifestPath = resolve(root, 'product/config/overlay-manifest.json')
const exceptionsPath = resolve(root, 'product/config/source-exceptions.json')
const overlaySourceRoot = resolve(root, 'product/app/frontend/source')

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function isInside(parent, candidate) {
  const value = relative(parent, candidate)
  return value !== '' && value !== '..' && !value.startsWith(`..${sep}`) && !value.startsWith(sep)
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
if (!existsSync(policyPath)) errors.push(`source policy is missing: ${policyPath}`)
if (!existsSync(upstreamRoot)) errors.push(`official source is missing: ${upstreamRoot}`)
if (!existsSync(manifestPath)) errors.push(`frontend overlay manifest is missing: ${manifestPath}`)
if (!existsSync(exceptionsPath)) errors.push(`source exception registry is missing: ${exceptionsPath}`)

let policy
let manifest
let exceptions
try { policy = readJson(policyPath) } catch (error) { errors.push(`source policy is invalid: ${String(error)}`) }
try { manifest = readJson(manifestPath) } catch (error) { errors.push(`overlay manifest is invalid: ${String(error)}`) }
try { exceptions = readJson(exceptionsPath) } catch (error) { errors.push(`source exception registry is invalid: ${String(error)}`) }

if (policy !== undefined) {
  if (policy.schema !== 'dsh.source-policy.v1') errors.push('unsupported source policy schema')
  if (policy.officialSource?.editPolicy !== 'deny-by-default') errors.push('official source edit policy must be deny-by-default')
  if (policy.officialSource?.mustRemainClean !== true) errors.push('official source must be configured as clean-only')
}

if (existsSync(upstreamRoot)) {
  const status = git(upstreamRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status !== '') {
    errors.push(`official source was modified; explicit user approval is required before any source edit is accepted:\n${status}`)
  }
}

const targetRoots = policy?.frontendOverlay?.targetRoots ?? []
if (manifest !== undefined) {
  if (manifest.schema !== 'dsh.product-overlay-manifest.v3') errors.push('frontend overlay manifest must use schema v3')
  if (manifest.backendPolicy !== 'upstream-only') errors.push('backend policy must be upstream-only')
  if (!Array.isArray(manifest.files)) errors.push('overlay manifest files must be an array')
  const indexedPaths = new Set()
  for (const row of manifest.files ?? []) {
    if (row?.layer !== 'frontend') {
      errors.push(`only frontend overlays are allowed: ${String(row?.layer)}/${String(row?.path)}`)
      continue
    }
    if (typeof row.path !== 'string' || !targetRoots.some(prefix => row.path.startsWith(prefix))) {
      errors.push(`overlay target is outside the WebUI plane: ${String(row?.path)}`)
    }
    if (typeof row.path === 'string') indexedPaths.add(row.path)
    const source = resolve(root, 'product/app/frontend/source', row.path ?? '')
    if (!isInside(resolve(root, 'product/app/frontend/source'), source)) {
      errors.push(`overlay source escapes product/app/frontend/source: ${String(row?.path)}`)
    }
  }
  if (existsSync(overlaySourceRoot)) {
    for (const path of sourceFiles(overlaySourceRoot)) {
      if (!indexedPaths.has(path)) errors.push(`WebUI source file is not indexed: ${path}`)
    }
  }
}

if (exceptions !== undefined) {
  if (exceptions.schema !== 'dsh.source-exceptions.v1' || !Array.isArray(exceptions.exceptions)) {
    errors.push('source exception registry has an invalid schema')
  }
  for (const entry of exceptions.exceptions ?? []) {
    if (typeof entry?.id !== 'string' || typeof entry?.target !== 'string' || typeof entry?.reason !== 'string') {
      errors.push('every direct source exception needs id, target, and reason')
      continue
    }
    if (entry.approvedByUser !== true || typeof entry.approvedAt !== 'string' || entry.approvedAt === '') {
      errors.push(`${entry.id}: direct source exception requires approvedByUser=true and approvedAt`)
    }
    if (!targetRoots.some(prefix => entry.target.startsWith(prefix))) {
      errors.push(`${entry.id}: direct source exception must target WebUI source only`)
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`source-policy: ${error}`)
  process.exitCode = 1
} else {
  console.log('source-policy: PASS (official source clean; product overlay limited to WebUI)')
}
