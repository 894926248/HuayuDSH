import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const legacyRoot = resolve(process.env.DSH_LEGACY_ROOT ?? join(root, '..', 'deepseek-harness'))
const currentRoot = resolve(root, 'product/current')
const sourceRoot = resolve(currentRoot, 'frontend/source')
const manifestPath = resolve(currentRoot, 'overlay-manifest.json')
const upstreamLockPath = resolve(root, 'product/manifests/upstream-lock.json')
const importLegacy = process.argv.includes('--import-legacy')

const files = [
  'apps/web/src/css.d.ts',
  'apps/web/src/desktop-chrome.css',
  'apps/web/src/desktop-chrome.ts',
  'apps/web/src/main.ts',
  'packages/client/ui-conversation/src/client/chat/ChatView.module.css',
  'packages/client/ui-conversation/src/client/chat/GenericCommandCard.module.css',
  'packages/client/ui-conversation/src/client/chat/MessageIconActions.module.css',
  'packages/client/ui-conversation/src/client/chat/MessageItem.module.css',
  'packages/client/ui-conversation/src/client/chat/ReasoningRow.module.css',
  'packages/client/ui-conversation/src/client/skeleton/InputBar.module.css',
  'packages/client/ui-layout/src/client/AppFrame.module.css',
  'packages/client/ui-layout/src/client/AppFrame.tsx',
  'packages/client/ui-layout/src/client/columns.ts',
  'packages/client/ui-layout/src/client/stores.ts',
]

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

const upstreamLock = JSON.parse(readFileSync(upstreamLockPath, 'utf8'))
if (upstreamLock?.schema !== 'dsh.upstream-lock.v1' || typeof upstreamLock.commit !== 'string') {
  throw new Error(`upstream lock is invalid: ${upstreamLockPath}`)
}

if (importLegacy) {
  for (const path of [
    sourceRoot,
    resolve(currentRoot, 'backend/source'),
    resolve(currentRoot, 'shared/source'),
    resolve(currentRoot, 'tooling/source'),
    resolve(currentRoot, 'patch'),
  ]) await rm(path, { recursive: true, force: true })
}
const rows = []
for (const path of files) {
  const destination = resolve(sourceRoot, path)
  if (importLegacy) {
    const source = resolve(legacyRoot, path)
    if (!existsSync(source)) throw new Error(`legacy frontend source is missing: ${source}`)
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination, { force: true })
  }
  if (!existsSync(destination)) throw new Error(`frontend product source is missing: ${destination}`)
  rows.push({ layer: 'frontend', path, sha256: digest(destination) })
}

await writeFile(manifestPath, `${JSON.stringify({
  schema: 'dsh.product-overlay-manifest.v2',
  sourceCommit: upstreamLock.commit,
  backendPolicy: 'upstream-only',
  files: rows,
}, null, 2)}\n`, 'utf8')
console.log(`frontend overlay: ${importLegacy ? 'imported and indexed' : 'indexed'} ${String(rows.length)} UI files`)
console.log(`frontend overlay: ${relative(root, manifestPath)}`)
