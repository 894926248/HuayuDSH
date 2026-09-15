import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeBuildResult } from './write-build-result.mjs'

const root = resolve(import.meta.dirname, '../..')
const installerRoot = resolve(root, '.workspace/artifacts/staging/desktop/installer')
const installer = resolve(installerRoot, 'DeepSeek Harness.exe')

function run(command, args) {
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command
  const invocation = process.platform === 'win32'
    ? { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', [executable, ...args].join(' ')] }
    : { file: executable, args }
  const result = spawnSync(invocation.file, invocation.args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`)
}

// The unpacked command owns source/runtime materialization and its own
// verification. The installer is always built from that exact fresh output.
run('pnpm', ['run', 'product:desktop:unpacked'])
rmSync(installerRoot, { recursive: true, force: true })
run('pnpm', [
  '--filter', '@deepseek-ai/dsh-desktop', 'exec', 'electron-builder',
  '--win', 'nsis', `--config.directories.output=${installerRoot}`,
])
if (!existsSync(installer)) {
  throw new Error(`installer-build: NSIS installer is missing: ${installer}`)
}
writeBuildResult({
  root,
  resultPath: resolve(root, '.workspace/artifacts/staging/desktop/installer-build-result.json'),
  state: 'installer-build',
  command: 'pnpm run product:desktop:installer',
  outputRoot: installerRoot,
  files: [installer],
})
