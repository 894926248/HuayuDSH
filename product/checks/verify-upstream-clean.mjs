import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const upstream = resolve(root, 'upstream')
const productOnlyRepository = !existsSync(resolve(root, 'packages')) && !existsSync(resolve(root, 'apps/web'))

if (!existsSync(upstream)) {
  console.error(`upstream worktree is missing: ${upstream}`)
  process.exitCode = 1
  process.exit()
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

const upstreamCommit = git(upstream, ['rev-parse', 'HEAD'])
const upstreamStatus = git(upstream, ['status', '--porcelain', '--untracked-files=all'])
if (upstreamStatus !== '') {
  console.error('upstream worktree is not clean:')
  console.error(upstreamStatus)
  process.exitCode = 1
}

if (productOnlyRepository) {
  console.log(`product-only repository: upstream source is external (${git(upstream, ['rev-parse', 'HEAD'])})`)
  if (upstreamStatus !== '') process.exitCode = 1
  process.exit()
}

const rootCommit = git(root, ['rev-parse', 'HEAD'])

const allowedPrefixes = [
  '.agents/',
  'apps/desktop/',
  'docs/',
  'plugins/',
  'product/',
  'scripts/',
]
const allowedFiles = new Set(['.gitignore', 'AGENTS.md'])
const officialPrefixes = [
  'apps/cli/',
  'apps/web/',
  'examples/',
  'native/',
  'packages/',
  'python/',
  'vendor/',
]
const baselineChanges = git(root, ['diff', '--name-only', '--no-renames', rootCommit, upstreamCommit, '--'])
  .split(/\r?\n/u)
  .filter(Boolean)
const workingChanges = git(root, ['diff', '--name-only', '--no-renames', 'HEAD', '--'])
  .split(/\r?\n/u)
  .filter(Boolean)
const untrackedSourceChanges = git(root, ['ls-files', '--others', '--exclude-standard'])
  .split(/\r?\n/u)
  .filter(path => officialPrefixes.some(prefix => path.startsWith(prefix)))
const outsideAllowlist = path => !allowedFiles.has(path) && !allowedPrefixes.some(prefix => path.startsWith(prefix))
const baselineOfficialChanges = baselineChanges.filter(outsideAllowlist).sort()
const workingOfficialChanges = [...new Set([...workingChanges, ...untrackedSourceChanges])]
  .filter(outsideAllowlist)
  .sort()

console.log(`upstream reference: ${upstreamCommit}`)
console.log(`active root commit: ${rootCommit}`)
if (baselineOfficialChanges.length > 0) {
  console.error(`upstream baseline mismatch: ${String(baselineOfficialChanges.length)} official path(s) differ between the active commit and upstream`)
}
if (workingOfficialChanges.length === 0 && baselineOfficialChanges.length === 0) {
  console.log('upstream source plane: clean')
} else {
  if (workingOfficialChanges.length > 0) {
    console.error(`working tree: ${String(workingOfficialChanges.length)} official path change(s) outside the product allowlist`)
  }
  const shown = workingOfficialChanges.slice(0, 120)
  for (const path of shown) console.error(`- ${path}`)
  if (shown.length < workingOfficialChanges.length) {
    console.error(`... ${String(workingOfficialChanges.length - shown.length)} more; compare the working tree with ${rootCommit} for the complete list`)
  }
  process.exitCode = 1
}
