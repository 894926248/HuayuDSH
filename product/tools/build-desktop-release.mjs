import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const upstreamRoot = resolve(root, 'upstream')
const artifactsRoot = resolve(root, '.workspace/artifacts')
const sourceRoot = resolve(artifactsRoot, 'staging/source')
const runtimeRoot = resolve(artifactsRoot, 'staging/runtime')
const runtimeDependenciesRoot = resolve(artifactsRoot, 'staging/runtime-deps')
const stagingRoot = resolve(artifactsRoot, 'staging/desktop')
const unpackedRoot = resolve(stagingRoot, 'win-unpacked')
const releasesRoot = resolve(artifactsRoot, 'releases')
const activeRoot = resolve(artifactsRoot, 'active')
const runtimeCacheRoot = resolve(artifactsRoot, 'cache')
const version = JSON.parse(readFileSync(resolve(root, 'product/config/product-version.json'), 'utf8')).version
const releaseRoot = resolve(releasesRoot, `v${version}`)
const releaseMode = process.argv.includes('--release')
const refreshRuntime = process.argv.includes('--refresh-runtime')
const runtimeOnly = process.argv.includes('--runtime-only')
const fastMode = process.argv.includes('--fast')
const replace = process.argv.includes('--replace')
const portableMode = process.argv.includes('--portable')

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

function requireClean(cwd, label) {
  const status = git(cwd, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status !== '') throw new Error(`${label} worktree is dirty:\n${status}`)
}

function runtimeIdentity() {
  const upstreamStatus = git(upstreamRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (upstreamStatus !== '') throw new Error(`official upstream is dirty:\n${upstreamStatus}`)
  const upstreamCommit = git(upstreamRoot, ['rev-parse', 'HEAD'])
  const key = `upstream-runtime-${upstreamCommit.slice(0, 12)}`
  const cacheRoot = resolve(runtimeCacheRoot, key)
  return { upstreamCommit, key, cacheRoot, runtimeRoot: resolve(cacheRoot, 'runtime') }
}

function runtimeCacheReady(identity) {
  const cacheRoots = [identity.cacheRoot]
  if (!existsSync(identity.cacheRoot) && existsSync(runtimeCacheRoot)) {
    for (const entry of readdirSync(runtimeCacheRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(`upstream-runtime-${identity.upstreamCommit.slice(0, 12)}`)) {
        cacheRoots.push(resolve(runtimeCacheRoot, entry.name))
      }
    }
  }
  for (const cacheRoot of cacheRoots) {
    const metadataPath = resolve(cacheRoot, 'runtime-cache.json')
    const runtimeRoot = resolve(cacheRoot, 'runtime')
    const entry = (existsSync(resolve(runtimeRoot, 'apps/cli/lib/bin.js'))
      || existsSync(resolve(runtimeRoot, 'lib/bin.js')))
      && existsSync(resolve(runtimeRoot, 'apps/web/vite.config.ts'))
      && existsSync(resolve(runtimeRoot, 'scripts/client-build-environment.ts'))
    const pnpmStore = resolve(runtimeRoot, 'node_modules/.pnpm')
    if (!entry || !existsSync(metadataPath) || existsSync(pnpmStore)) continue
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
      if (metadata.schema === 'dsh.runtime-cache.v1'
        && metadata.layout === 'materialized-official-worktree-v1'
        && metadata.upstreamCommit === identity.upstreamCommit) {
        identity.cacheRoot = cacheRoot
        identity.runtimeRoot = runtimeRoot
        return true
      }
    } catch {
      // Try the next cache candidate.
    }
  }
  return false
}

function writeRuntimeCache(identity) {
  if (existsSync(resolve(runtimeRoot, 'node_modules/.pnpm'))) {
    throw new Error('refusing to cache a pnpm-linked runtime; materialize the official dependency closure first')
  }
  rmSync(identity.cacheRoot, { recursive: true, force: true })
  mkdirSync(identity.cacheRoot, { recursive: true })
  cpSync(runtimeRoot, identity.runtimeRoot, { recursive: true, dereference: true })
  writeFileSync(resolve(identity.cacheRoot, 'runtime-cache.json'), `${JSON.stringify({
    schema: 'dsh.runtime-cache.v1',
    layout: 'materialized-official-worktree-v1',
    upstreamCommit: identity.upstreamCommit,
    createdAtUtc: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8')
}

function applyFrontendOverlay(runtime) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'product/config/overlay-manifest.json'), 'utf8'))
  const overlayRoot = resolve(root, 'product/app/frontend/source')
  const runtimeRootPath = resolve(runtime)
  for (const row of manifest.files) {
    if (row?.layer !== 'frontend' || typeof row.path !== 'string' || typeof row.sha256 !== 'string') {
      throw new Error('product overlay manifest contains an invalid file row')
    }
    const source = resolve(overlayRoot, row.path)
    const target = resolve(runtime, row.path)
    const sourceRelative = relative(overlayRoot, source)
    const targetRelative = relative(runtimeRootPath, target)
    if (sourceRelative === '..' || sourceRelative.startsWith('..\\') || sourceRelative.startsWith('../')
      || targetRelative === '..' || targetRelative.startsWith('..\\') || targetRelative.startsWith('../')) {
      throw new Error(`product overlay path escapes its root: ${row.path}`)
    }
    const digest = createHash('sha256').update(readFileSync(source)).digest('hex')
    if (digest !== row.sha256) throw new Error(`product overlay hash mismatch: ${row.path}`)
    mkdirSync(resolve(target, '..'), { recursive: true })
    cpSync(source, target, { force: true })
  }
}

function frontendOverlayKey() {
  const manifest = JSON.parse(readFileSync(resolve(root, 'product/config/overlay-manifest.json'), 'utf8'))
  return createHash('sha256').update(manifest.files.map(row => `${row.path}:${row.sha256}`).join('\n')).digest('hex')
}

function buildFrontendIfNeeded() {
  const marker = resolve(runtimeRoot, 'apps/web/dist/.dsh-overlay-key')
  const packagedDist = resolve(runtimeRoot, 'node_modules/@deepseek-ai/dsh-web-frontend/dist')
  const key = frontendOverlayKey()
  const needsBuild = !existsSync(marker) || readFileSync(marker, 'utf8').trim() !== key
  if (needsBuild) run('pnpm', ['run', 'build:web'], runtimeRoot)
  // The Host resolves the frontend through the published package export, not
  // apps/web/dist directly. Keep the package dist in lockstep with the Vite
  // output so a successful build cannot serve a stale HTML/hash pair.
  rmSync(packagedDist, { recursive: true, force: true })
  cpSync(resolve(runtimeRoot, 'apps/web/dist'), packagedDist, { recursive: true, dereference: true })
  if (needsBuild) writeFileSync(marker, `${key}\n`, 'utf8')
}

function stageRuntimeFromCache(identity) {
  const cachedTimeoutBundle = resolve(identity.runtimeRoot, 'node_modules/@deepseek-ai/dsh-timeout/lib/index.js')
  const stagedTimeoutBundle = resolve(runtimeRoot, 'node_modules/@deepseek-ai/dsh-timeout/lib/index.js')
  if (existsSync(resolve(runtimeRoot, 'apps/cli/lib/bin.js'))
    && existsSync(resolve(runtimeRoot, 'apps/web/vite.config.ts'))
    && existsSync(resolve(runtimeRoot, 'scripts/client-build-environment.ts'))
    && !existsSync(resolve(runtimeRoot, 'node_modules/.pnpm'))) {
    if (!existsSync(cachedTimeoutBundle)) throw new Error(`runtime cache is missing timeout bundle: ${cachedTimeoutBundle}`)
    mkdirSync(resolve(stagedTimeoutBundle, '..'), { recursive: true })
    cpSync(cachedTimeoutBundle, stagedTimeoutBundle, { force: true })
    return
  }
  rmSync(runtimeRoot, { recursive: true, force: true })
  rmSync(runtimeDependenciesRoot, { recursive: true, force: true })
  mkdirSync(resolve(runtimeRoot, '..'), { recursive: true })
  cpSync(identity.runtimeRoot, runtimeRoot, {
    recursive: true,
    dereference: true,
    // Keep the official dependency tree inside staging. Junctions do not survive
    // electron-builder reliably when their target is outside the package.
  })
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

function preparePackagedRuntime(source) {
  rmSync(runtimeRoot, { recursive: true, force: true })
  mkdirSync(resolve(runtimeRoot, '..'), { recursive: true })
  run('node', ['product/tools/materialize-runtime.mjs', source, runtimeRoot])
}

function stageRuntimeDependencies() {
  const dependencyRoot = resolve(runtimeRoot, 'node_modules')
  const required = [
    resolve(runtimeRoot, 'apps/cli/lib/bin.js'),
    resolve(dependencyRoot, '@deepseek-ai/dsh-app-boot/lib/index.js'),
    resolve(dependencyRoot, '@deepseek-ai/cordis-plugin-loader/lib/index.js'),
  ]
  if (required.some(path => !existsSync(path))) {
    throw new Error(`packaged runtime dependencies are missing: ${dependencyRoot}`)
  }
}

function stageOfficialVersions() {
  const tags = git(upstreamRoot, ['tag', '--list', 'dsh-v*', '--sort=version:refname'])
    .split(/\r?\n/u)
    .map(tag => tag.trim())
    .filter(tag => /^dsh-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(tag))
  const versions = tags.map(tag => ({
    version: tag.slice('dsh-v'.length),
    tag,
    commit: git(upstreamRoot, ['rev-list', '-n', '1', tag]),
  }))
  writeFileSync(resolve(runtimeRoot, 'official-versions.json'), `${JSON.stringify({
    schema: 'dsh.official-versions.v1',
    source: 'https://github.com/deepseek-ai/deepseek-harness',
    versions,
  }, null, 2)}\n`)
}

function stageRuntimeRecoveryPolicy() {
  cpSync(
    resolve(root, 'product/config/runtime-recovery.patch.yml'),
    resolve(runtimeRoot, 'runtime-recovery.patch.yml'),
    { force: true },
  )
}

function stageProductPlugins() {
  const registry = JSON.parse(readFileSync(resolve(root, 'plugins/registry.json'), 'utf8'))
  const locals = (registry.plugins ?? []).filter(row => row?.kind === 'product-local' && typeof row?.path === 'string')
  if (locals.length === 0) return
  for (const row of locals) {
    const source = resolve(root, row.path)
    const id = basename(resolve(source))
    const manifestPath = resolve(source, 'package.json')
    if (!existsSync(manifestPath)) continue
    for (const target of [
      resolve(runtimeRoot, 'node_modules', id),
      resolve(runtimeRoot, 'node_modules/@deepseek-ai/cordis-plugin-loader/node_modules', id),
    ]) {
      rmSync(target, { recursive: true, force: true })
      mkdirSync(resolve(target, '..'), { recursive: true })
      // Copy the plugin package without its own node_modules: plugin runtime
      // dependencies resolve through the runtime's node_modules parent-walk
      // (peer dependencies are staged separately by stageProductPluginPeerDependencies).
      for (const entry of readdirSync(source)) {
        if (entry === 'node_modules') continue
        cpSync(resolve(source, entry), resolve(target, entry), { recursive: true, dereference: true })
      }
    }
  }
}

function stageProductPluginPeerDependencies() {
  const ready = existsSync(resolve(root, 'plugins/dsh-commandcode-provider/node_modules/@deepseek-ai/cosmokit'))
  if (ready) return
  const registry = JSON.parse(readFileSync(resolve(root, 'plugins/registry.json'), 'utf8'))
  for (const row of registry.plugins ?? []) {
    if (row?.kind !== 'product-local' || typeof row.path !== 'string') continue
    const pluginRoot = resolve(root, row.path)
    const manifestPath = resolve(pluginRoot, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const dependencies = {
      ...(typeof manifest.dependencies === 'object' && manifest.dependencies !== null ? manifest.dependencies : {}),
      ...(typeof manifest.peerDependencies === 'object' && manifest.peerDependencies !== null ? manifest.peerDependencies : {}),
    }
    const pending = [...Object.keys(dependencies)]
    const seen = new Set()
    while (pending.length > 0) {
      const name = pending.shift()
      if (typeof name !== 'string' || seen.has(name)) continue
      seen.add(name)
      const source = resolve(runtimeRoot, 'node_modules', name)
      if (!existsSync(source)) continue
      const target = resolve(pluginRoot, 'node_modules', name)
      rmSync(target, { recursive: true, force: true })
      mkdirSync(resolve(target, '..'), { recursive: true })
      cpSync(source, target, { recursive: true, dereference: true })
      const childManifest = resolve(source, 'package.json')
      if (existsSync(childManifest)) {
        const child = JSON.parse(readFileSync(childManifest, 'utf8'))
        for (const group of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
          if (typeof child[group] !== 'object' || child[group] === null) continue
          pending.push(...Object.keys(child[group]))
        }
      }
    }
  }
}

function refreshUnpackedFast() {
  const resourcesRoot = resolve(unpackedRoot, 'resources')
  const appRoot = resolve(resourcesRoot, 'app')
  if (!existsSync(resolve(appRoot, 'lib/bundle/main.js')) || !existsSync(resolve(resourcesRoot, 'runtime'))) return false
  for (const relativePath of [
    'apps/web/dist',
    'node_modules/@deepseek-ai/dsh-web-frontend/dist',
    // Keep the official timeout bundle explicit so a fast refresh cannot leave
    // a stale runtime copy behind.
    'node_modules/@deepseek-ai/dsh-timeout/lib/index.js',
    'runtime-recovery.patch.yml',
  ]) {
    const source = resolve(runtimeRoot, relativePath)
    const target = resolve(resourcesRoot, 'runtime', relativePath)
    rmSync(target, { recursive: true, force: true })
    cpSync(source, target, { recursive: true, dereference: true })
  }
  // Product built-in plugins (staged into the runtime by stageProductPlugins)
  // must reach the packaged runtime node_modules on the fast path too.
  const registryForRefresh = JSON.parse(readFileSync(resolve(root, 'plugins/registry.json'), 'utf8'))
  for (const row of registryForRefresh.plugins ?? []) {
    if (row?.kind !== 'product-local' || typeof row?.path !== 'string') continue
    const pluginId = basename(resolve(root, row.path))
    const pluginSource = resolve(runtimeRoot, 'node_modules', pluginId)
    if (!existsSync(pluginSource)) continue
    for (const pluginTarget of [
      resolve(resourcesRoot, 'runtime/node_modules', pluginId),
      resolve(resourcesRoot, 'runtime/node_modules/@deepseek-ai/cordis-plugin-loader/node_modules', pluginId),
    ]) {
      rmSync(pluginTarget, { recursive: true, force: true })
      mkdirSync(resolve(pluginTarget, '..'), { recursive: true })
      for (const entry of readdirSync(pluginSource)) {
        if (entry === 'node_modules') continue
        cpSync(resolve(pluginSource, entry), resolve(pluginTarget, entry), { recursive: true, dereference: true })
      }
    }
  }
  // Older staging packages may contain the removed sidecar. The fast path
  // owns this disposable directory, so remove that stale runtime tree.
  rmSync(resolve(resourcesRoot, 'runtime/hermes-recovery'), { recursive: true, force: true })
  cpSync(resolve(runtimeRoot, 'official-versions.json'), resolve(resourcesRoot, 'runtime', 'official-versions.json'), { force: true })
  rmSync(resolve(appRoot, 'lib/bundle'), { recursive: true, force: true })
  cpSync(resolve(root, 'product/app/desktop/lib/bundle'), resolve(appRoot, 'lib/bundle'), { recursive: true, dereference: true })
  cpSync(resolve(root, 'product/app/desktop/package.json'), resolve(appRoot, 'package.json'), { force: true })
  cpSync(resolve(root, 'product/app/desktop/build/host-root.json'), resolve(resourcesRoot, 'host-root.json'), { force: true })
  return true
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

function publishActive(sourceRoot, includeAll = true) {
  rmSync(activeRoot, { recursive: true, force: true })
  mkdirSync(activeRoot, { recursive: true })
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.isFile() && (includeAll || entry.name.endsWith('.exe'))) {
      cpSync(resolve(sourceRoot, entry.name), resolve(activeRoot, entry.name))
    }
  }
}

try {
  requireBuildDependencies()
  const identity = runtimeIdentity()
  if (releaseMode) {
    requireClean(root, 'product')
    run('node', ['product/tools/verify-repository-layout.mjs'])
    run('node', ['product/tools/verify-source-policy.mjs'])
    run('node', ['product/tools/validate-product-index.mjs', 'validate'])
    run('node', ['product/tools/verify-product-source.mjs'])
  }
  if (releaseMode && existsSync(releaseRoot) && !replace) {
    throw new Error(`release already exists: ${releaseRoot}; use --replace only for the same unreleased version`)
  }

  if (refreshRuntime || !runtimeCacheReady(identity)) {
    if (fastMode) throw new Error(`runtime cache is missing for ${identity.key}; run pnpm run product:runtime:refresh once`)
    console.log(`runtime-cache: ${refreshRuntime ? 'refreshing' : 'building'} ${identity.key}`)
    rmSync(stagingRoot, { recursive: true, force: true })
    mkdirSync(stagingRoot, { recursive: true })
    run('node', ['product/tools/prepare-product-source.mjs', '.workspace/artifacts/staging/source'])
    const previousSourceRoot = process.env.DSH_DESKTOP_SOURCE_ROOT
    const previousPackagedRuntimeRoot = process.env.DSH_DESKTOP_PACKAGED_RUNTIME_ROOT
    process.env.DSH_DESKTOP_SOURCE_ROOT = sourceRoot
    process.env.DSH_DESKTOP_PACKAGED_RUNTIME_ROOT = 'runtime'
    try {
      cleanUpstreamBuildOutputs(sourceRoot)
      const temporaryBuildFiles = prepareUpstreamBuildScaffold(sourceRoot)
      try {
        buildUpstream(sourceRoot)
        applyFrontendOverlay(sourceRoot)
        run('pnpm', ['run', 'build:web'], sourceRoot)
      } finally {
        for (const path of temporaryBuildFiles) rmSync(path, { force: true })
      }
      preparePackagedRuntime(sourceRoot)
      writeRuntimeCache(identity)
      stageRuntimeFromCache(identity)
    } finally {
      if (previousSourceRoot === undefined) delete process.env.DSH_DESKTOP_SOURCE_ROOT
      else process.env.DSH_DESKTOP_SOURCE_ROOT = previousSourceRoot
      if (previousPackagedRuntimeRoot === undefined) delete process.env.DSH_DESKTOP_PACKAGED_RUNTIME_ROOT
      else process.env.DSH_DESKTOP_PACKAGED_RUNTIME_ROOT = previousPackagedRuntimeRoot
      await removeSourceWorktree()
    }
  } else {
    console.log(`runtime-cache: hit ${identity.key}`)
    stageRuntimeFromCache(identity)
    applyFrontendOverlay(runtimeRoot)
    buildFrontendIfNeeded()
  }
  stageProductPlugins()
  stageProductPluginPeerDependencies()
  stageOfficialVersions()
  stageRuntimeRecoveryPolicy()
  if (!existsSync(resolve(runtimeRoot, 'apps/web/dist/index.html'))) {
    throw new Error('runtime cache is incomplete: apps/web/dist/index.html is missing; run the runtime/web build steps')
  }
  if (runtimeOnly) process.exit(0)

  run('pnpm', ['--filter', '@deepseek-ai/dsh-desktop', 'run', 'build'])
  const previousPackagedSourceRoot = process.env.DSH_DESKTOP_SOURCE_ROOT
  const previousPackagedRuntimeRoot = process.env.DSH_DESKTOP_PACKAGED_RUNTIME_ROOT
  process.env.DSH_DESKTOP_SOURCE_ROOT = runtimeRoot
  process.env.DSH_DESKTOP_PACKAGED_RUNTIME_ROOT = 'runtime'
  try {
    run('pnpm', ['--filter', '@deepseek-ai/dsh-desktop', 'run', 'stage-host'])
    stageRuntimeDependencies()
    const refreshed = fastMode && refreshUnpackedFast()
    if (!refreshed) {
      rmSync(stagingRoot, { recursive: true, force: true })
      mkdirSync(stagingRoot, { recursive: true })
      // `--dir` leaves only `win-unpacked/`; the portable distribution mode
      // additionally needs the single-file `win.target: portable` artifact
      // (its own `.exe` at the staging root) that the version menu downloads.
      // The package config keeps `compression: store` for fast unpacked dev
      // builds, but NSIS (3.0.4.1) memory-maps the embedded app archive and
      // fails above 2 GB — which the stored full runtime exceeds — so portable
      // mode asks for a real compression level instead.
      run('pnpm', [
        '--filter', '@deepseek-ai/dsh-desktop', 'exec', 'electron-builder',
        ...(portableMode ? ['--config.compression=normal'] : ['--dir']),
      ])
    }
    run('node', ['product/app/desktop/scripts/runtime-host.mjs', 'verify', '--unpacked', unpackedRoot])
  } finally {
    if (previousPackagedSourceRoot === undefined) delete process.env.DSH_DESKTOP_SOURCE_ROOT
    else process.env.DSH_DESKTOP_SOURCE_ROOT = previousPackagedSourceRoot
    if (previousPackagedRuntimeRoot === undefined) delete process.env.DSH_DESKTOP_PACKAGED_RUNTIME_ROOT
    else process.env.DSH_DESKTOP_PACKAGED_RUNTIME_ROOT = previousPackagedRuntimeRoot
  }
  if (releaseMode) {
    copyTopLevelArtifacts()
    run('node', ['product/tools/release-lock.mjs', 'write', '--version', version, '--artifact-root', `.workspace/artifacts/releases/v${version}`])
    publishActive(releaseRoot)
  } else {
    publishActive(stagingRoot, false)
  }
  if (releaseMode) {
    run('node', ['product/tools/release-lock.mjs', 'verify', '--manifest', '.workspace/artifacts/active/release-lock.json'])
    run('node', ['product/tools/retain-artifacts.mjs', 'prune'])
  }
} catch (error) {
  console.error(`desktop-release: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
