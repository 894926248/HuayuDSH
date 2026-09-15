import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { writeBuildResult } from './write-build-result.mjs'

const root = resolve(import.meta.dirname, '../..')
const source = resolve(root, '.workspace/artifacts/staging/source')
if (!existsSync(resolve(source, 'package.json'))) {
  throw new Error('web-build: prepared source is missing; run product:source-prepare first')
}
const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm'
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'pnpm run build:web']
  : ['run', 'build:web']
const result = spawnSync(command, args, {
  cwd: source,
  stdio: 'inherit',
  windowsHide: true,
})
if (result.error) throw result.error
if (result.status !== 0) {
  console.error(`web-build: child exited with status ${String(result.status)}${result.signal ? `, signal ${result.signal}` : ''}`)
  process.exit(result.status ?? 1)
}
const dist = resolve(source, 'apps/web/dist')
const asset = readdirSync(resolve(dist, 'assets')).find(name => /\.js$/iu.test(name))
if (asset === undefined) throw new Error(`web-build: no JavaScript asset found under ${resolve(dist, 'assets')}`)
writeBuildResult({
  root,
  resultPath: resolve(root, '.workspace/artifacts/staging/web-build-result.json'),
  state: 'web-build',
  command: 'pnpm run build:web',
  outputRoot: dist,
  files: [resolve(dist, 'index.html'), resolve(dist, 'assets', asset)],
})
