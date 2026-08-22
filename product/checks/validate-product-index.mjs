import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const indexPath = resolve(root, 'product/index/registry.json')
const command = process.argv[2] ?? 'validate'
const areaArgIndex = process.argv.indexOf('--area')
const areaFilter = areaArgIndex === -1 ? undefined : process.argv[areaArgIndex + 1]

function fail(message) {
  console.error(`product-index: ${message}`)
  process.exitCode = 1
}

if (!existsSync(indexPath)) {
  fail(`registry is missing: ${indexPath}`)
  process.exit()
}

let registry
try {
  registry = JSON.parse(readFileSync(indexPath, 'utf8'))
} catch (error) {
  fail(`registry is not valid JSON: ${String(error)}`)
  process.exit()
}

const errors = []
if (registry.schema !== 'dsh.product-index.v1') errors.push('unsupported schema')
if (typeof registry.project !== 'string' || registry.project === '') errors.push('project is missing')
if (!Array.isArray(registry.areas) || registry.areas.length === 0) errors.push('areas must be a non-empty array')
if (!Array.isArray(registry.changes)) errors.push('changes must be an array')

const areas = new Set()
for (const area of registry.areas ?? []) {
  if (typeof area?.id !== 'string' || typeof area?.name !== 'string') {
    errors.push('every area needs string id and name')
    continue
  }
  if (!/^[a-z][a-z0-9-]*$/u.test(area.id)) errors.push(`invalid area id: ${area.id}`)
  if (!areas.add(area.id)) errors.push(`duplicate area id: ${area.id}`)
}

const ids = new Set()
const statuses = new Set(['ACTIVE', 'MIGRATING', 'EXTENSION_REQUIRED', 'DEFERRED', 'DROPPED'])
for (const change of registry.changes ?? []) {
  if (typeof change?.id !== 'string' || typeof change?.title !== 'string') {
    errors.push('every change needs string id and title')
    continue
  }
  if (!ids.add(change.id)) errors.push(`duplicate change id: ${change.id}`)
  if (!areas.has(change.area)) errors.push(`${change.id}: unknown area ${JSON.stringify(change.area)}`)
  if (!statuses.has(change.status)) errors.push(`${change.id}: unknown status ${JSON.stringify(change.status)}`)
  if (typeof change.owner !== 'string' || !change.owner.startsWith('product/') || change.owner.startsWith('product/artifacts/')) {
    errors.push(`${change.id}: owner must be a product source directory, not an artifact directory`)
  } else if (!existsSync(resolve(root, change.owner))) {
    errors.push(`${change.id}: owner path is missing: ${change.owner}`)
  }
  if (!Array.isArray(change.sourcePaths) || change.sourcePaths.some(path => typeof path !== 'string' || path.startsWith('/') || path.includes('..'))) {
    errors.push(`${change.id}: sourcePaths must contain repository-relative paths`)
  }
  for (const field of ['upstreamDependency', 'updateRule', 'verify']) {
    if (typeof change[field] !== 'string' || change[field] === '') errors.push(`${change.id}: ${field} is missing`)
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
  process.exit()
}

const selected = (registry.changes ?? []).filter(change => areaFilter === undefined || change.area === areaFilter)
if (areaFilter !== undefined && !areas.has(areaFilter)) {
  fail(`unknown area filter: ${areaFilter}`)
  process.exit()
}

if (command === 'validate') {
  console.log(`product-index: valid (${String(registry.changes.length)} changes, ${String(registry.areas.length)} areas)`)
} else if (command === 'list') {
  for (const change of selected) console.log(`${change.id}\t${change.area}\t${change.status}\t${change.title}`)
} else {
  fail(`unknown command ${command}; use validate or list`)
}
