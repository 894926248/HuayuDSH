import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const upstreamRoot = resolve(root, 'upstream')
const versionPath = resolve(root, 'product/manifests/product-version.json')
const defaultArtifactRoot = resolve(root, 'product/artifacts/staging/current')

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

function parseOptions() {
  const args = process.argv.slice(2)
  const command = args[0] ?? 'verify'
  const values = new Map()
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index]
    if (value?.startsWith('--')) values.set(value, args[++index])
    else throw new Error(`unexpected argument: ${value}`)
  }
  return { command, values }
}

function option(values, name, fallback) {
  const value = values.get(name)
  return value === undefined ? fallback : value
}

function assertInside(parent, target, label) {
  const local = relative(parent, target)
  if (local === '..' || local.startsWith(`..${sep}`) || local === '' || resolve(parent, local) !== target) {
    throw new Error(`${label} must be inside ${parent}: ${target}`)
  }
}

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sourceState(cwd) {
  const status = git(cwd, ['status', '--porcelain=v1', '--untracked-files=all'])
  return {
    commit: git(cwd, ['rev-parse', 'HEAD']),
    tree: git(cwd, ['rev-parse', 'HEAD^{tree}']),
    branch: git(cwd, ['branch', '--show-current']),
    dirty: status !== '',
    status,
  }
}

function walkFiles(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`release artifact symlink is not allowed: ${path}`)
    if (entry.isDirectory()) walkFiles(path, output)
    else if (entry.isFile() && !['release-lock.json', 'SHA256SUMS.txt'].includes(entry.name)) output.push(path)
    else if (!entry.isDirectory() && !entry.isFile()) throw new Error(`unsupported release artifact entry: ${path}`)
  }
  return output
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function artifactRecords(artifactRoot) {
  const files = walkFiles(artifactRoot).sort()
  if (files.length === 0) throw new Error(`release artifact directory is empty: ${artifactRoot}`)
  return Promise.all(files.map(async path => ({
    path: relative(artifactRoot, path).split(sep).join('/'),
    bytes: statSync(path).size,
    sha256: await hashFile(path),
  })))
}

function readProductVersion(expected) {
  if (!existsSync(versionPath)) throw new Error(`product version manifest is missing: ${versionPath}`)
  const value = json(versionPath)
  if (value.schema !== 'dsh.product-version.v1' || typeof value.version !== 'string') {
    throw new Error(`product version manifest is invalid: ${versionPath}`)
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value.version)) throw new Error(`product version is not SemVer-like: ${value.version}`)
  if (expected !== undefined && value.version !== expected) throw new Error(`requested version ${expected} does not match ${value.version}`)
  return value
}

function requireCleanReleaseSources() {
  const product = sourceState(root)
  if (product.dirty) throw new Error(`product release requires a clean Git worktree:\n${product.status}`)
  if (!existsSync(upstreamRoot)) throw new Error(`pinned upstream worktree is missing: ${upstreamRoot}`)
  const upstream = sourceState(upstreamRoot)
  if (upstream.dirty) throw new Error(`pinned upstream worktree is dirty:\n${upstream.status}`)
  return { product, upstream }
}

async function writeLock(values) {
  const version = readProductVersion(option(values, '--version', undefined))
  const artifactRoot = resolve(root, option(values, '--artifact-root', relative(root, defaultArtifactRoot)))
  const output = resolve(root, option(values, '--manifest', relative(root, resolve(artifactRoot, 'release-lock.json'))))
  assertInside(resolve(root, 'product/artifacts'), artifactRoot, 'artifact root')
  assertInside(resolve(root, 'product/artifacts'), output, 'manifest')
  if (!existsSync(artifactRoot) || !statSync(artifactRoot).isDirectory()) throw new Error(`artifact root is missing: ${artifactRoot}`)
  const sources = requireCleanReleaseSources()
  const artifacts = await artifactRecords(artifactRoot)
  const manifest = {
    schema: 'dsh.release-lock.v1',
    product: { name: version.product, version: version.version, channel: version.channel },
    buildId: `v${version.version}+git.${sources.product.commit.slice(0, 12)}.upstream.${sources.upstream.commit.slice(0, 12)}`,
    generatedAtUtc: new Date().toISOString(),
    git: { commit: sources.product.commit, tree: sources.product.tree, branch: sources.product.branch, dirty: false },
    upstream: { commit: sources.upstream.commit, tree: sources.upstream.tree },
    artifacts,
  }
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const sums = artifacts.map(artifact => `${artifact.sha256}  ${artifact.path}`).join('\n') + '\n'
  writeFileSync(resolve(dirname(output), 'SHA256SUMS.txt'), sums, 'utf8')
  console.log(`release-lock: wrote ${output}`)
  console.log(`release-lock: ${manifest.buildId}`)
}

async function verifyLock(values) {
  const manifestPath = resolve(root, option(values, '--manifest', relative(root, resolve(root, 'product/artifacts/active/release-lock.json'))))
  assertInside(resolve(root, 'product/artifacts'), manifestPath, 'manifest')
  if (!existsSync(manifestPath)) throw new Error(`release lock is missing: ${manifestPath}`)
  const manifest = json(manifestPath)
  if (manifest.schema !== 'dsh.release-lock.v1' || manifest.git?.dirty !== false) throw new Error('release lock is not a clean release record')
  const sources = requireCleanReleaseSources()
  for (const [label, expected, actual] of [
    ['product commit', manifest.git.commit, sources.product.commit],
    ['product tree', manifest.git.tree, sources.product.tree],
    ['upstream commit', manifest.upstream.commit, sources.upstream.commit],
    ['upstream tree', manifest.upstream.tree, sources.upstream.tree],
  ]) if (expected !== actual) throw new Error(`release lock ${label} mismatch: ${expected} != ${actual}`)
  const packageRoot = dirname(manifestPath)
  for (const artifact of manifest.artifacts ?? []) {
    if (typeof artifact.path !== 'string' || artifact.path.startsWith('/') || artifact.path.includes('..')) throw new Error(`invalid artifact path: ${artifact.path}`)
    const path = resolve(packageRoot, artifact.path)
    assertInside(packageRoot, path, 'artifact')
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`artifact is missing: ${path}`)
    if (statSync(path).size !== artifact.bytes || await hashFile(path) !== artifact.sha256) throw new Error(`artifact hash mismatch: ${artifact.path}`)
  }
  console.log(`release-lock: PASS ${manifest.buildId}`)
}

const { command, values } = parseOptions()
try {
  if (command === 'write') await writeLock(values)
  else if (command === 'verify') await verifyLock(values)
  else throw new Error(`unknown command ${command}; use write or verify`)
} catch (error) {
  console.error(`release-lock: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
