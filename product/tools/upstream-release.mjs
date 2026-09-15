import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Read the release identity from the official upstream checkout. */
export function readUpstreamRelease(root) {
  const upstreamRoot = resolve(root, 'upstream')
  const packageJson = JSON.parse(readFileSync(resolve(upstreamRoot, 'package.json'), 'utf8'))
  const commit = execFileSync('git', ['-C', upstreamRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const tag = execFileSync('git', ['-C', upstreamRoot, 'describe', '--tags', '--exact-match', 'HEAD'], { encoding: 'utf8' }).trim()
  const expectedTag = `dsh-v${packageJson.version}`
  if (typeof packageJson.version !== 'string' || tag !== expectedTag) {
    throw new Error(`upstream release identity mismatch: package=${String(packageJson.version)}, tag=${tag}`)
  }
  return { version: packageJson.version, tag, commit }
}
