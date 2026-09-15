import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readUpstreamRelease } from './upstream-release.mjs'

const root = resolve(import.meta.dirname, '../..')
const upstreamRoot = resolve(root, 'upstream')
const [command = 'list', reference] = process.argv.slice(2)

function git(args, options = {}) {
  return execFileSync('git', ['-C', upstreamRoot, ...args], { encoding: 'utf8', stdio: 'pipe', ...options }).trim()
}

function requireClean() {
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'])
  if (status !== '') throw new Error(`upstream worktree is dirty:\n${status}`)
}

function requireSourcePolicy() {
  execFileSync(process.execPath, [resolve(root, 'product/tools/verify-source-policy.mjs')], { stdio: 'inherit' })
}

function list() {
  const current = (() => {
    try { return readUpstreamRelease(root) } catch { return undefined }
  })()
  if (current !== undefined) console.log(`current\t${current.version}\t${current.tag}\t${current.commit}`)
  for (const tag of git(['tag', '--list', 'dsh-v*', '--sort=-v:refname']).split(/\r?\n/u).filter(Boolean)) {
    const commit = git(['rev-list', '-n', '1', tag])
    const version = tag.slice('dsh-v'.length)
    console.log(`available\t${version}\t${tag}\t${commit}`)
  }
}

function fetch() {
  requireClean()
  execFileSync('git', ['-C', upstreamRoot, 'fetch', '--tags', 'origin'], { stdio: 'inherit' })
  console.log('upstream: fetched official tags; existing tags remain local for offline rollback')
}

function select(ref) {
  if (ref === undefined || ref === '') throw new Error('usage: select-upstream.mjs select <tag-or-commit>')
  requireSourcePolicy()
  requireClean()
  const commit = git(['rev-parse', '--verify', `${ref}^{commit}`])
  execFileSync('git', ['-C', upstreamRoot, 'checkout', '--detach', ref], { stdio: 'inherit' })
  const packageVersion = JSON.parse(readFileSync(resolve(upstreamRoot, 'package.json'), 'utf8')).version
  let tag = '(unreleased commit)'
  try { tag = git(['describe', '--tags', '--exact-match', 'HEAD']) } catch {}
  console.log(`upstream: selected ${packageVersion} ${tag} ${commit}`)
  console.log('next: run pnpm run product:frontend-sync, then commit the upstream gitlink with the product change')
}

if (command === 'list') list()
else if (command === 'fetch') fetch()
else if (command === 'select' || command === 'rollback') select(reference)
else throw new Error(`unknown command: ${command}; use list, fetch, select, or rollback`)
