import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const upstreamRoot = resolve(root, 'upstream')
const artifactsRoot = resolve(root, 'product/artifacts')
const sourceRoot = resolve(artifactsRoot, 'staging/source')
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
  const env = command === 'pnpm' ? { ...process.env, CI: 'true' } : undefined
  const result = spawnSync(invocation.file, invocation.args, { cwd, stdio: 'inherit', windowsHide: true, shell: invocation.shell, env })
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

function prepareUpstreamBuildScaffold(source) {
  const temporaryFiles = []
  const directory = resolve(source, 'lib/types')
  mkdirSync(directory, { recursive: true })
  for (const name of ['index.js', 'invariant.js', 'startup.js', '{index,invariant,startup}.js']) {
    const path = resolve(directory, name)
    if (!existsSync(path)) writeFileSync(path, 'export {}\n', 'utf8')
  }
  const packageDirectories = []
  for (const entry of readdirSync(resolve(source, 'vendor'), { withFileTypes: true })) {
    if (entry.isDirectory()) packageDirectories.push(resolve(source, 'vendor', entry.name))
  }
  for (const group of readdirSync(resolve(source, 'packages'), { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const entry of readdirSync(resolve(source, 'packages', group.name), { withFileTypes: true })) {
      if (entry.isDirectory()) packageDirectories.push(resolve(source, 'packages', group.name, entry.name))
    }
  }
  for (const directory of packageDirectories) {
    const packagePath = resolve(directory, 'package.json')
    const configPath = resolve(directory, 'tsdown.config.ts')
    if (!existsSync(packagePath) || existsSync(configPath)) continue
    const entries = ['index', 'invariant', 'startup']
      .filter(name => existsSync(resolve(directory, 'src', `${name}.ts`)))
      .map(name => `lib/types/${name}.js`)
    if (entries.length === 0) continue
    const config = `import { defineConfig } from 'tsdown'\n\nexport default defineConfig(({ env }) => ({\n  entry: env?.DSH_BUILD_FACE === 'client' ? '' : ${JSON.stringify(entries)},\n  outDir: 'lib',\n  format: ['esm'],\n  platform: 'node',\n  target: 'es2024',\n  fixedExtension: false,\n  dts: false,\n  clean: false,\n}))\n`
    writeFileSync(configPath, config, 'utf8')
    temporaryFiles.push(configPath)
  }
  return temporaryFiles
}

function cleanUpstreamBuildOutputs(source) {
  run('pnpm', ['run', 'clean'], source)
}

function buildUpstream(source) {
  const configPath = resolve(source, 'tsdown.config.ts')
  const original = readFileSync(configPath, 'utf8')
  const sourceEntry = "entry: client ? '' : ['lib/types/{index,invariant,startup}.js']"
  const rootEntry = resolve(source, 'lib/types/index.js').replaceAll('\\', '/')
  const buildEntry = `entry: client ? '' : ['${rootEntry}']`
  if (!original.includes(sourceEntry)) throw new Error('upstream tsdown config entry contract changed; inspect before release')
  writeFileSync(configPath, original.replace(sourceEntry, buildEntry), 'utf8')
  try {
    run('pnpm', ['run', 'build'], source)
  } finally {
    writeFileSync(configPath, original, 'utf8')
  }
}

async function removeSourceWorktree() {
  try { git(upstreamRoot, ['worktree', 'remove', '--force', sourceRoot]) } catch {}
  await rm(sourceRoot, { recursive: true, force: true })
  try { git(upstreamRoot, ['worktree', 'prune']) } catch {}
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
  run('node', ['product/checks/verify-product-source.mjs'])
  if (existsSync(releaseRoot) && !replace) {
    throw new Error(`release already exists: ${releaseRoot}; use --replace only for the same unreleased version`)
  }

  rmSync(stagingRoot, { recursive: true, force: true })
  mkdirSync(stagingRoot, { recursive: true })
  run('node', ['product/build/prepare-product-source.mjs', 'product/artifacts/staging/source'])
  const previousSourceRoot = process.env.DSH_DESKTOP_SOURCE_ROOT
  process.env.DSH_DESKTOP_SOURCE_ROOT = sourceRoot
  try {
    cleanUpstreamBuildOutputs(sourceRoot)
    const temporaryBuildFiles = prepareUpstreamBuildScaffold(sourceRoot)
    try {
      buildUpstream(sourceRoot)
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
  } finally {
    if (previousSourceRoot === undefined) delete process.env.DSH_DESKTOP_SOURCE_ROOT
    else process.env.DSH_DESKTOP_SOURCE_ROOT = previousSourceRoot
    await removeSourceWorktree()
  }
  copyTopLevelArtifacts()
  run('node', ['product/checks/release-lock.mjs', 'write', '--version', version, '--artifact-root', `product/artifacts/releases/v${version}`])
  publishActive()
  run('node', ['product/checks/release-lock.mjs', 'verify', '--manifest', 'product/artifacts/active/release-lock.json'])
  run('node', ['product/checks/retain-artifacts.mjs', 'prune'])
} catch (error) {
  console.error(`desktop-release: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
