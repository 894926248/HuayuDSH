import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const upstreamRoot = resolve(root, 'upstream')
const artifactsRoot = resolve(root, 'product/artifacts')
const stagingRoot = resolve(artifactsRoot, 'staging/desktop')
const unpackedRoot = resolve(stagingRoot, 'win-unpacked')
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

function run(command, args, cwd = root) {
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command
  const invocation = process.platform === 'win32'
    ? { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', [executable, ...args].join(' ')], shell: false }
    : { file: executable, args, shell: false }
  const result = spawnSync(invocation.file, invocation.args, { cwd, stdio: 'inherit', windowsHide: true, shell: invocation.shell })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`)
}

function requireBuildDependencies() {
  const required = [
    resolve(root, 'node_modules/.bin/tsc'),
    resolve(root, 'node_modules/.bin/tsdown'),
    resolve(root, 'node_modules/.bin/electron-builder'),
  ]
  const missing = required.filter(path => !existsSync(path) && !existsSync(`${path}.cmd`))
  if (missing.length > 0) throw new Error(`product dependencies are missing; run pnpm install in ${root}`)
}

function prepareUpstreamBuildScaffold() {
  const temporaryFiles = []
  const directory = resolve(upstreamRoot, 'lib/types')
  mkdirSync(directory, { recursive: true })
  for (const name of ['index.js', 'invariant.js', 'startup.js', '{index,invariant,startup}.js']) {
    const path = resolve(directory, name)
    if (!existsSync(path)) writeFileSync(path, 'export {}\n', 'utf8')
  }
  const config = `import { defineConfig } from 'tsdown'\n\nexport default defineConfig({\n  entry: ['lib/types/index.js'],\n  outDir: 'lib',\n  format: ['esm'],\n  platform: 'node',\n  target: 'es2024',\n  fixedExtension: false,\n  dts: false,\n  clean: false,\n})\n`
  for (const entry of readdirSync(resolve(upstreamRoot, 'vendor'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = resolve(upstreamRoot, 'vendor', entry.name)
    const packagePath = resolve(directory, 'package.json')
    const configPath = resolve(directory, 'tsdown.config.ts')
    if (!existsSync(packagePath) || existsSync(configPath)) continue
    writeFileSync(configPath, config, 'utf8')
    temporaryFiles.push(configPath)
  }
  return temporaryFiles
}

function cleanUpstreamBuildOutputs() {
  run('pnpm', ['run', 'clean'], upstreamRoot)
}

function buildUpstream() {
  const configPath = resolve(upstreamRoot, 'tsdown.config.ts')
  const original = readFileSync(configPath, 'utf8')
  const sourceEntry = "entry: client ? '' : ['lib/types/{index,invariant,startup}.js']"
  const rootEntry = resolve(upstreamRoot, 'lib/types/index.js').replaceAll('\\', '/')
  const buildEntry = `entry: client ? '' : ['${rootEntry}']`
  if (!original.includes(sourceEntry)) throw new Error('upstream tsdown config entry contract changed; inspect before release')
  writeFileSync(configPath, original.replace(sourceEntry, buildEntry), 'utf8')
  try {
    run('pnpm', ['run', 'build'], upstreamRoot)
  } finally {
    writeFileSync(configPath, original, 'utf8')
  }
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
  if (!readdirSync(releaseRoot).some(name => name.endsWith('.exe'))) {
    throw new Error(`desktop staging produced no executable in ${stagingRoot}`)
  }
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
  requireClean(upstreamRoot, 'upstream')
  requireBuildDependencies()
  run('node', ['product/checks/validate-product-index.mjs', 'validate'])
  if (existsSync(releaseRoot) && !replace) {
    throw new Error(`release already exists: ${releaseRoot}; use --replace only for the same unreleased version`)
  }

  rmSync(stagingRoot, { recursive: true, force: true })
  mkdirSync(stagingRoot, { recursive: true })
  cleanUpstreamBuildOutputs()
  const temporaryBuildFiles = prepareUpstreamBuildScaffold()
  try {
    buildUpstream()
  } finally {
    for (const path of temporaryBuildFiles) rmSync(path, { force: true })
  }
  run('pnpm', ['--filter', '@huayu-dsh/desktop', 'run', 'build'])
  run('pnpm', ['--filter', '@huayu-dsh/desktop', 'run', 'stage-host'])
  run('pnpm', ['--filter', '@huayu-dsh/desktop', 'exec', 'electron-builder'])
  run('node', [
    'product/current/desktop/scripts/runtime-host.mjs',
    'verify',
    '--unpacked',
    unpackedRoot,
  ])
  copyTopLevelArtifacts()
  run('node', ['product/checks/release-lock.mjs', 'write', '--version', version, '--artifact-root', `product/artifacts/releases/v${version}`])
  publishActive()
  run('node', ['product/checks/release-lock.mjs', 'verify', '--manifest', 'product/artifacts/active/release-lock.json'])
  run('node', ['product/checks/retain-artifacts.mjs', 'prune'])
} catch (error) {
  console.error(`desktop-release: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
