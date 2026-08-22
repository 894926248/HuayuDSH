import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const artifactsRoot = resolve(root, 'product/artifacts')
const retentionPath = resolve(root, 'product/manifests/retention.json')
const command = process.argv[2] ?? 'list'
const retention = JSON.parse(readFileSync(retentionPath, 'utf8'))

function directories(path) {
  if (!existsSync(path)) return []
  return readdirSync(path, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
    .map(entry => ({ name: entry.name, path: resolve(path, entry.name), mtime: statSync(resolve(path, entry.name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime)
}

function releases() {
  return directories(resolve(artifactsRoot, 'releases')).map(entry => {
    const lockPath = resolve(entry.path, 'release-lock.json')
    let version = entry.name
    let buildId = ''
    if (existsSync(lockPath)) {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
      version = lock.product?.version ?? version
      buildId = lock.buildId ?? ''
    }
    return { ...entry, version, buildId }
  })
}

function list() {
  console.log(`artifacts root: ${artifactsRoot}`)
  for (const release of releases()) console.log(`release\t${release.version}\t${release.name}\t${release.buildId}`)
  for (const cache of directories(resolve(artifactsRoot, 'cache'))) console.log(`cache\t${cache.name}`)
  for (const stage of directories(resolve(artifactsRoot, 'staging'))) console.log(`staging\t${stage.name}`)
}

function prune() {
  const keptReleases = releases().slice(0, retention.successfulReleases)
  const keepReleasePaths = new Set(keptReleases.map(entry => entry.path))
  for (const release of releases().slice(retention.successfulReleases)) {
    if (!keepReleasePaths.has(release.path)) {
      rmSync(release.path, { recursive: true, force: true })
      console.log(`removed release: ${release.name}`)
    }
  }
  for (const cache of directories(resolve(artifactsRoot, 'cache')).slice(retention.cacheEntries)) {
    rmSync(cache.path, { recursive: true, force: true })
    console.log(`removed cache: ${cache.name}`)
  }
  const stagingRoot = resolve(artifactsRoot, 'staging')
  for (const stage of directories(stagingRoot).slice(retention.stagingDirectories)) {
    rmSync(stage.path, { recursive: true, force: true })
    console.log(`removed staging: ${stage.name}`)
  }
}

if (command === 'list') list()
else if (command === 'prune') prune()
else {
  console.error(`artifact-retention: unknown command ${command}; use list or prune`)
  process.exitCode = 1
}
