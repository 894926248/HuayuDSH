import { cpSync, existsSync, lstatSync, mkdirSync, realpathSync, readdirSync, rmSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const source = resolve(process.argv[2] ?? '')
const destination = resolve(process.argv[3] ?? '')

if (process.argv.length !== 4) {
  throw new Error('usage: node product/tools/materialize-runtime.mjs <pnpm-runtime> <output-runtime>')
}

const virtualRoot = resolve(source, 'node_modules/.pnpm/node_modules')
const sourceNodeModules = resolve(source, 'node_modules')
const sourceEntry = existsSync(resolve(source, 'apps/cli/lib/bin.js'))
  ? 'apps/cli/lib/bin.js'
  : 'lib/bin.js'
if (!existsSync(resolve(source, sourceEntry)) || !existsSync(virtualRoot)) {
  throw new Error(`runtime does not contain the expected official closure: ${source}`)
}

function copyPackage(link, target) {
  const sourcePackage = realpathSync(link)
  cpSync(sourcePackage, target, {
    recursive: true,
    dereference: true,
    filter: path => basename(path) !== 'node_modules',
  })
}

function materializeScope(scope) {
  const output = resolve(destination, 'node_modules', scope.name)
  mkdirSync(output, { recursive: true })
  for (const entry of readdirSync(resolve(virtualRoot, scope.name), { withFileTypes: true })) {
    if (entry.name === '.bin') continue
    copyPackage(resolve(virtualRoot, scope.name, entry.name), resolve(output, entry.name))
  }
}

rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })
cpSync(source, destination, {
  recursive: true,
  dereference: true,
  filter: path => !['.git', 'node_modules'].includes(basename(path)),
})
mkdirSync(resolve(destination, 'node_modules'), { recursive: true })

for (const entry of readdirSync(virtualRoot, { withFileTypes: true })) {
  if (entry.name === '.bin') continue
  const path = resolve(virtualRoot, entry.name)
  if (entry.isDirectory()) materializeScope(entry)
  else if (lstatSync(path).isSymbolicLink()) copyPackage(path, resolve(destination, 'node_modules', entry.name))
}

// pnpm keeps some direct runtime dependencies as links in the worktree root
// rather than in the hoisted virtual root (for example js-yaml). Preserve
// those links as real package directories in the packaged, junction-free tree.
for (const entry of readdirSync(sourceNodeModules, { withFileTypes: true })) {
  if (entry.name === '.pnpm' || entry.name === '.bin' || entry.name === '.modules.yaml') continue
  const path = resolve(sourceNodeModules, entry.name)
  if (entry.isSymbolicLink()) {
    copyPackage(path, resolve(destination, 'node_modules', entry.name))
    continue
  }
  if (!entry.isDirectory() || !entry.name.startsWith('@')) continue
  const targetScope = resolve(destination, 'node_modules', entry.name)
  for (const child of readdirSync(path, { withFileTypes: true })) {
    if (!child.isSymbolicLink()) continue
    copyPackage(resolve(path, child.name), resolve(targetScope, child.name))
  }
}

console.log(`runtime-materialize: ${sourceEntry} ${source} -> ${destination}`)
