import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeBuildResult } from './write-build-result.mjs'

const root = resolve(import.meta.dirname, '../..')
const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm'
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'pnpm run product:build']
  : ['run', 'product:build']
const result = spawnSync(command, args, {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
})
if (result.error) throw result.error
if (result.status !== 0) {
  console.error(`portable-build: child exited with status ${String(result.status)}${result.signal ? `, signal ${result.signal}` : ''}`)
  process.exit(result.status ?? 1)
}
const outputRoot = resolve(root, '.workspace/artifacts/staging/desktop')
const exe = resolve(outputRoot, 'DeepSeek Harness.exe')
if (!existsSync(exe)) throw new Error(`portable-build: portable executable is missing: ${exe}`)
writeBuildResult({
  root,
  resultPath: resolve(root, '.workspace/artifacts/staging/desktop/portable-build-result.json'),
  state: 'portable-build',
  command: 'pnpm run product:desktop:portable',
  outputRoot,
  files: [exe],
})
