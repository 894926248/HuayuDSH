import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const installer = resolve(root, '.workspace/artifacts/staging/desktop/installer/DeepSeek Harness.exe')
const unpackedRoot = resolve(root, '.workspace/artifacts/staging/desktop/win-unpacked')
const installerResultPath = resolve(root, '.workspace/artifacts/staging/desktop/installer-build-result.json')
const shortcutPath = resolve(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData/Roaming'), 'Microsoft/Windows/Start Menu/Programs/DeepSeek Harness.lnk')

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
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`)
  }
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`desktop-install: required manifest is missing: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function shortcutTarget(path) {
  if (!existsSync(path)) return undefined
  const escaped = path.replaceAll("'", "''")
  const script = `$shell=New-Object -ComObject WScript.Shell; $shortcut=$shell.CreateShortcut('${escaped}'); [Console]::Write($shortcut.TargetPath)`
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim()
  } catch {
    return undefined
  }
}

function oldUninstallerRunning() {
  const result = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq old-uninstaller.exe', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return result.status === 0 && result.stdout.toLowerCase().includes('old-uninstaller.exe')
}

function terminateOrphanedOldUninstaller() {
  const script = [
    `$children=@(Get-CimInstance Win32_Process -Filter "Name = 'old-uninstaller.exe'")`,
    'foreach ($child in $children) {',
    '  $parent=Get-Process -Id $child.ParentProcessId -ErrorAction SilentlyContinue',
    '  if ($null -eq $parent) { Stop-Process -Id $child.ProcessId -Force; [Console]::WriteLine($child.ProcessId) }',
    '}',
  ].join(' ')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`desktop-install: failed to terminate orphaned old NSIS uninstaller: ${String(result.status)}`)
  return result.stdout.trim().split(/\s+/u).filter(Boolean)
}

function waitForOldUninstaller() {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "$processes=Get-Process -Name old-uninstaller -ErrorAction SilentlyContinue; if ($null -ne $processes) { $processes | Wait-Process -Timeout 60 }",
  ], { stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status === 0) return
  const terminated = terminateOrphanedOldUninstaller()
  if (terminated.length === 0) {
    throw new Error(`desktop-install: old NSIS uninstaller did not exit: ${String(result.status)}`)
  }
  console.warn(`desktop-install: terminated orphaned old NSIS uninstaller ${terminated.join(', ')}`)
}

function installerProcessRunning(path) {
  const escaped = path.replaceAll("'", "''")
  const script = `$target='${escaped}'; $p=Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target }; if ($null -ne $p) { 'running' }`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return result.status === 0 && result.stdout.trim() === 'running'
}

function waitForInstaller(path) {
  const escaped = path.replaceAll("'", "''")
  const script = "$target='" + escaped + "'; $p=Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target }; if ($null -ne $p) { $p | ForEach-Object { Wait-Process -Id $_.ProcessId -Timeout 600 } }"
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`desktop-install: NSIS installer process did not exit: ${String(result.status)}`)
}

const verifyOnly = process.argv.includes('--verify-only')
const reuseInstaller = process.argv.includes('--reuse-installer')
if (verifyOnly && reuseInstaller) {
  throw new Error('desktop-install: --verify-only and --reuse-installer cannot be combined')
}
if (!verifyOnly && !reuseInstaller) {
  // Installation owns the complete chain. The installer command refreshes the
  // unpacked desktop package first, then creates a fresh NSIS artifact for this
  // installation; stale staging output is never consumed implicitly.
  run('pnpm', ['run', 'product:desktop:installer'])
}

const installerResult = readJson(installerResultPath)
if (installerResult.schema !== 'dsh.build-result.v1' || installerResult.state !== 'installer-build') {
  throw new Error(`desktop-install: installer result is not current: ${installerResultPath}`)
}
if (!existsSync(installer)) throw new Error(`desktop-install: installer is missing: ${installer}`)
const installerEntry = installerResult.files?.find(entry => resolve(root, entry.path) === installer)
if (installerEntry === undefined) throw new Error(`desktop-install: installer manifest does not identify ${installer}`)
if (statSync(installer).size !== installerEntry.bytes || hash(installer) !== installerEntry.sha256) {
  throw new Error(`desktop-install: installer artifact does not match ${installerResultPath}`)
}

const command = verifyOnly
  ? 'node product/tools/install-desktop.mjs --verify-only'
  : reuseInstaller
    ? 'node product/tools/install-desktop.mjs --reuse-installer'
    : 'pnpm run product:desktop:install'
let result = { status: 0, error: undefined }
if (!verifyOnly) {
  result = spawnSync(installer, ['/S'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
  })
  if (result.error) throw result.error
  // NSIS update mode launches the previous uninstaller and returns before
  // that child finishes. Wait for the handoff, then retry the same installer.
  if (result.status === 1 && oldUninstallerRunning()) {
    waitForOldUninstaller()
    result = spawnSync(installer, ['/S'], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      shell: false,
    })
    if (result.error) throw result.error
  }
  // A one-click installer can leave a detached copy doing the 7z extraction
  // after the launcher returns status 2. Wait for that copy; the installed
  // target and hashes below remain the final authority.
  if (result.status !== 0 && installerProcessRunning(installer)) waitForInstaller(installer)
  if (result.status !== 0 && !existsSync(shortcutPath)) {
    throw new Error(`desktop-install: installer exited with code ${String(result.status)}`)
  }
}

const target = shortcutTarget(shortcutPath)
if (target === undefined || target === '') throw new Error(`desktop-install: Start Menu shortcut is missing: ${shortcutPath}`)
const installedExe = resolve(target)
const installedRoot = dirname(installedExe)

const critical = [
  'DeepSeek Harness.exe',
  'resources/runtime/runtime-recovery.patch.yml',
]
const files = critical.map(relativePath => {
  const source = resolve(unpackedRoot, relativePath)
  const target = join(installedRoot, relativePath)
  if (!existsSync(source)) throw new Error(`desktop-install: source artifact is missing: ${source}`)
  if (!existsSync(target)) throw new Error(`desktop-install: installed artifact is missing: ${target}`)
  const sourceHash = hash(source)
  const targetHash = hash(target)
  if (statSync(source).size !== statSync(target).size || sourceHash !== targetHash) {
    throw new Error(`desktop-install: installed artifact differs from unpacked-build: ${relativePath}`)
  }
  return {
    relativePath,
    path: target,
    bytes: statSync(target).size,
    sha256: targetHash,
  }
})

const resultPath = resolve(root, '.workspace/artifacts/staging/desktop/installed-build-result.json')
mkdirSync(resolve(resultPath, '..'), { recursive: true })
writeFileSync(resultPath, `${JSON.stringify({
  schema: 'dsh.installed-build-result.v1',
  state: 'installed',
  command,
  completedAtUtc: new Date().toISOString(),
  installRoot: installedRoot,
  shortcut: { path: shortcutPath, target },
  files,
}, null, 2)}\n`, 'utf8')
console.log(`installed-result: ${JSON.stringify({ path: resultPath, installRoot: installedRoot, files })}`)
