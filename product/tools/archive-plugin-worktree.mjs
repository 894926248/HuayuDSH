import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const pluginRoot = resolve(root, 'plugins/dsh-market')
const archiveRoot = resolve(root, 'product/migration/plugins/dsh-market')
const filesRoot = resolve(archiveRoot, 'files')

function git(args) {
  return execFileSync('git', ['-C', pluginRoot, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

function copyPath(path) {
  const source = resolve(pluginRoot, path)
  const destination = resolve(filesRoot, path)
  if (!existsSync(source) || !lstatSync(source).isFile()) return false
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { dereference: false })
  return true
}

if (existsSync(archiveRoot)) throw new Error(`plugin archive already exists: ${archiveRoot}`)
const changed = git(['diff', '--name-only', 'HEAD']).trim().split(/\r?\n/u).filter(Boolean)
const untracked = git(['ls-files', '--others', '--exclude-standard']).trim().split(/\r?\n/u).filter(Boolean)
const copied = [...new Set([...changed, ...untracked])].filter(copyPath)

mkdirSync(archiveRoot, { recursive: true })
writeFileSync(resolve(archiveRoot, 'changes.patch'), git(['diff', '--binary', 'HEAD']), 'utf8')
writeFileSync(resolve(archiveRoot, 'manifest.json'), `${JSON.stringify({
  schema: 'dsh.plugin-legacy-archive.v1',
  plugin: 'dsh-market',
  commit: git(['rev-parse', 'HEAD']).trim(),
  remote: git(['remote', 'get-url', 'origin']).trim(),
  changedPaths: changed,
  untrackedPaths: untracked,
  copiedPaths: copied,
}, null, 2)}\n`, 'utf8')

console.log(`plugin archive: ${String(copied.length)} files at ${archiveRoot}`)
