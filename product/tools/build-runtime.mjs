import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['run', 'product:runtime:refresh'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
})
if (result.status !== 0) process.exit(result.status ?? 1)
