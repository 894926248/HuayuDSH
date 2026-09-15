import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeBuildResult } from './write-build-result.mjs'

const root = resolve(import.meta.dirname, '../..')
const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm'
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'pnpm run product:build:fast']
  : ['run', 'product:build:fast']
const result = spawnSync(command, args, {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
})
if (result.error) throw result.error
if (result.status !== 0) {
  console.error(`unpacked-build: child exited with status ${String(result.status)}${result.signal ? `, signal ${result.signal}` : ''}`)
  process.exit(result.status ?? 1)
}
const outputRoot = resolve(root, '.workspace/artifacts/staging/desktop/win-unpacked')
const exe = resolve(outputRoot, 'DeepSeek Harness.exe')
const mainBundle = resolve(outputRoot, 'resources/app/lib/bundle/main.js')
const runtimeIndex = resolve(outputRoot, 'resources/runtime/apps/web/dist/index.html')
const runtimeRecoveryPatch = resolve(outputRoot, 'resources/runtime/runtime-recovery.patch.yml')
const runtimeMarker = resolve(root, '.workspace/artifacts/staging/runtime/apps/web/dist/.dsh-overlay-key')
const legacyRecoveryRoot = resolve(outputRoot, 'resources/runtime/hermes-recovery')
if (!existsSync(exe) || !existsSync(mainBundle) || !existsSync(runtimeIndex) || !existsSync(runtimeRecoveryPatch)) {
  throw new Error(`unpacked-build: expected output is missing under ${outputRoot}`)
}
if (existsSync(legacyRecoveryRoot)) {
  throw new Error(`unpacked-build: legacy recovery runtime remains under ${legacyRecoveryRoot}`)
}
const files = [exe, mainBundle, runtimeIndex, runtimeRecoveryPatch]
if (existsSync(runtimeMarker)) files.push(runtimeMarker)
writeBuildResult({
  root,
  resultPath: resolve(root, '.workspace/artifacts/staging/desktop/unpacked-build-result.json'),
  state: 'unpacked-build',
  command: 'pnpm run product:desktop:unpacked',
  outputRoot,
  files,
})
