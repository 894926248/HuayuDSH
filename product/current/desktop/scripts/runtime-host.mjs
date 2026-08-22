import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { access, cp, lstat, mkdir, mkdtemp, readFile, readlink, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const desktopRoot = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(process.env.DSH_DESKTOP_SOURCE_ROOT ?? resolve(desktopRoot, '..', '..', '..', 'upstream'))
const runtimeRoot = resolve(desktopRoot, '..', '..', 'artifacts', 'staging', 'runtime')
const payloadRoot = join(runtimeRoot, 'dsh-host-payload')
const payloadMetadataFile = '.desktop-host-payload.json'
const hostEntry = join('lib', 'bin.js')

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  options: { unpacked: { type: 'string' } },
  allowPositionals: true,
})
const command = positionals[0]

if (command === 'stage') await stage()
else if (command === 'verify') await verify(values.unpacked)
else throw new Error('usage: node scripts/runtime-host.mjs <stage|verify> [--unpacked <win-unpacked>]')

async function stage() {
  await access(join(sourceRoot, 'apps', 'cli', 'package.json'))
  await rm(payloadRoot, { recursive: true, force: true })
  await mkdir(dirname(payloadRoot), { recursive: true })
  await deployProductionClosure()
  await materializeLinks(payloadRoot)
  const id = createHash('sha256')
    .update(`${git('rev-parse', 'HEAD')}\n${readFileSync(join(sourceRoot, 'apps', 'cli', 'package.json'), 'utf8')}`)
    .digest('hex')
  await writeFile(join(payloadRoot, payloadMetadataFile), `${JSON.stringify({ version: 1, id, links: [] }, null, 2)}\n`)
  await verifyPayload(payloadRoot)
  console.log(`desktop host closure: staged ${payloadRoot}`)
}

async function materializeLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) {
      const target = resolve(dirname(path), await readlink(path))
      await rm(path, { recursive: true, force: true })
      await cp(target, path, { recursive: true, force: true })
    } else if (metadata.isDirectory()) {
      await materializeLinks(path)
    }
  }
}

async function deployProductionClosure() {
  const cliPackagePath = join(sourceRoot, 'apps', 'cli', 'package.json')
  const original = await readFile(cliPackagePath, 'utf8')
  const manifest = JSON.parse(original)
  const workspacePackages = await collectWorkspacePackages()
  const requiredPeers = collectRuntimePeers(manifest, workspacePackages)
  const dependencies = { ...manifest.dependencies }
  for (const name of requiredPeers) {
    if (dependencies[name] === undefined) dependencies[name] = 'workspace:^'
  }
  manifest.dependencies = dependencies
  await writeFile(cliPackagePath, `${JSON.stringify(manifest, null, 2)}\n`)
  try {
    execFileSync('pnpm.cmd', ['--config.node-linker=hoisted', 'deploy', '--filter', '@deepseek-ai/dsh', '--prod', '--legacy', '--force', payloadRoot], {
      cwd: sourceRoot,
      env: { ...process.env, CI: 'true' },
      stdio: 'inherit',
      windowsHide: true,
      shell: true,
    })
  } finally {
    await writeFile(cliPackagePath, original)
  }
}

async function collectWorkspacePackages() {
  const roots = ['apps', 'packages', 'vendor', 'native']
  const packages = new Map()
  for (const root of roots) await visit(resolve(sourceRoot, root), packages)
  return packages
}

async function visit(directory, packages) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if (entries.some(entry => entry.isFile() && entry.name === 'package.json')) {
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    if (typeof manifest.name === 'string') packages.set(manifest.name, manifest)
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !['node_modules', 'lib', 'dist', '.git'].includes(entry.name)) {
      await visit(join(directory, entry.name), packages)
    }
  }
}

function collectRuntimePeers(rootManifest, workspacePackages) {
  const seen = new Set()
  const queue = Object.keys(rootManifest.dependencies ?? {})
  for (const name of queue) if (workspacePackages.has(name)) seen.add(name)
  for (let index = 0; index < queue.length; index += 1) {
    const manifest = workspacePackages.get(queue[index])
    if (manifest === undefined) continue
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const dependency of Object.keys(manifest[section] ?? {})) {
        if (workspacePackages.has(dependency) && !seen.has(dependency)) {
          seen.add(dependency)
          queue.push(dependency)
        }
      }
    }
  }
  return [...seen].sort()
}

async function verify(unpacked) {
  const root = unpacked === undefined ? payloadRoot : join(resolve(unpacked), 'resources', 'dsh-host-payload')
  await verifyPayload(root)
  console.log(`desktop host closure: verified ${root}`)
}

async function verifyPayload(root) {
  const metadata = JSON.parse(await readFile(join(root, payloadMetadataFile), 'utf8'))
  if (metadata?.version !== 1 || typeof metadata.id !== 'string' || !Array.isArray(metadata.links) || metadata.links.length !== 0) {
    throw new Error(`desktop host closure: invalid metadata at ${root}`)
  }
  const entry = join(root, hostEntry)
  if (!existsSync(entry)) throw new Error(`desktop host closure: entry is missing at ${entry}`)
  const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-host-'))
  try {
    await runNode(root, entry, ['--profile', 'web', '--dump-config'], home)
    await verifyStandardPresetImports(root, home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

async function verifyStandardPresetImports(root, home) {
  const preset = await readFile(join(root, 'config', 'agent-presets', 'standard', 'agent.cordis.yml'), 'utf8')
  const packageNames = new Set()
  for (const match of preset.matchAll(/^\s*name:\s+['"]?([^'"\s]+)['"]?\s*$/gmu)) {
    if (match[1]?.startsWith('@deepseek-ai/')) packageNames.add(match[1])
  }
  const profileEntry = join(home, 'profiles', 'web', 'cordis.yml')
  const requireFromProfile = createRequire(profileEntry)
  for (const packageName of [...packageNames].sort()) requireFromProfile.resolve(packageName)
}

async function runNode(cwd, entry, args, home) {
  await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, ['--expose-internals', entry, ...args], {
      cwd,
      env: { ...process.env, DSH_HOME: home },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-8192) })
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolveExit()
      : reject(new Error(`desktop host closure: profile boot failed with code ${String(code)}: ${stderr.trim()}`)))
  })
}

function git(...args) {
  return execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8' }).trim()
}
