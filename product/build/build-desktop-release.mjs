import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const artifactsRoot = resolve(root, 'product/artifacts')
const stagingRoot = resolve(artifactsRoot, 'staging/desktop')
const releasesRoot = resolve(artifactsRoot, 'releases')
const activeRoot = resolve(artifactsRoot, 'active')
const version = JSON.parse(readFileSync(resolve(root, 'product/manifests/product-version.json'), 'utf8')).version
const releaseRoot = resolve(releasesRoot, `v${version}`)
const replace = process.argv.includes('--replace')

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

function requireClean(cwd, label) {
  const status = git(cwd, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status !== '') throw new Error(`${label} worktree is dirty:\n${status}`)
}

function run(command, args) {
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`)
}

function copyTopLevelArtifacts() {
  if (!existsSync(stagingRoot)) throw new Error(`desktop staging output is missing: ${stagingRoot}`)
  rmSync(releaseRoot, { recursive: true, force: true })
  mkdirSync(releaseRoot, { recursive: true })
  for (const entry of readdirSync(stagingRoot, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (!/\.(exe|blockmap|yml|yaml)$/iu.test(entry.name)) continue
    cpSync(resolve(stagingRoot, entry.name), resolve(releaseRoot, entry.name))
  }
  if (!readdirSync(releaseRoot).some(name => name.endsWith('.exe'))) throw new Error(`desktop staging produced no executable in ${stagingRoot}`)
}

function publishActive() {
  rmSync(activeRoot, { recursive: true, force: true })
  mkdirSync(activeRoot, { recursive: true })
  for (const entry of readdirSync(releaseRoot, { withFileTypes: true })) {
    if (entry.isFile()) cpSync(resolve(releaseRoot, entry.name), resolve(activeRoot, entry.name))
  }
}

try {
  requireClean(root, 'product')
  requireClean(resolve(root, 'upstream'), 'upstream')
  run('node', ['product/checks/validate-product-index.mjs', 'validate'])
  if (existsSync(releaseRoot) && !replace) throw new Error(`release already exists: ${releaseRoot}; use --replace only for the same unreleased version`)
  rmSync(stagingRoot, { recursive: true, force: true })
  mkdirSync(stagingRoot, { recursive: true })
  run('pnpm', ['run', 'build:desktop'])
  run('pnpm', ['--filter', '@deepseek-ai/dsh-desktop', 'run', 'dist'])
  copyTopLevelArtifacts()
  run('node', ['product/checks/release-lock.mjs', 'write', '--version', version, '--artifact-root', `product/artifacts/releases/v${version}`])
  publishActive()
  run('node', ['product/checks/release-lock.mjs', 'verify', '--manifest', 'product/artifacts/active/release-lock.json'])
  run('node', ['product/checks/retain-artifacts.mjs', 'prune'])
} catch (error) {
  console.error(`desktop-release: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
