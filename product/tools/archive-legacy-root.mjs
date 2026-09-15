import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const archiveRoot = resolve(root, 'product/migration/legacy-root')
const filesRoot = resolve(archiveRoot, 'files')
const excludedPrefixes = ['product/', 'plugins/', 'upstream/', 'node_modules/', 'coverage/', '.playwright-mcp/']
const excludedPaths = new Set(['.gitmodules'])

function git(args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function include(path) {
  return !excludedPaths.has(path) && !excludedPrefixes.some(prefix => path.startsWith(prefix))
}

function copyPath(path) {
  const source = resolve(root, path)
  const destination = resolve(filesRoot, path)
  if (!existsSync(source) || !lstatSync(source).isFile()) return false
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { dereference: false })
  return true
}

if (existsSync(archiveRoot)) throw new Error(`legacy archive already exists: ${archiveRoot}`)

const changed = git(['diff', '--name-only', 'HEAD']).trim().split(/\r?\n/u).filter(Boolean).filter(include)
const untracked = git(['ls-files', '--others', '--exclude-standard']).trim().split(/\r?\n/u).filter(Boolean).filter(include)
const copied = [...new Set([...changed, ...untracked])].filter(copyPath)

mkdirSync(archiveRoot, { recursive: true })
writeFileSync(resolve(archiveRoot, 'changes.patch'), git(['diff', '--binary', 'HEAD']), 'utf8')
writeFileSync(resolve(archiveRoot, 'manifest.json'), `${JSON.stringify({
  schema: 'dsh.legacy-root-archive.v1',
  rootCommit: git(['rev-parse', 'HEAD']).trim(),
  sourceRemote: git(['remote', 'get-url', 'origin']).trim(),
  changedPaths: changed,
  untrackedPaths: untracked,
  copiedPaths: copied,
}, null, 2)}\n`, 'utf8')

console.log(`legacy-root: archived ${String(copied.length)} files at ${archiveRoot}`)
