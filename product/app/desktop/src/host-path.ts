import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Relative path of the built CLI entry that owns the Web profile. */
export const SOURCE_HOST_ENTRY = join('apps', 'cli', 'lib', 'bin.js')
export const PACKAGED_HOST_ENTRY = join('lib', 'bin.js')
export const OFFICIAL_PACKAGE_HOST_ENTRY = join('@deepseek-ai', 'dsh', 'lib', 'bin.js')

/**
 * Resolve the source checkout's CLI entry from Electron's development app root.
 * @param appPath - Electron's un-packaged application directory.
 * @param explicitEntry - Optional deployment override for the CLI entry.
 * @returns the absolute CLI entry path used by the embedded profile.
 */
export function resolveDevelopmentHostEntry(appPath: string, explicitEntry?: string): string {
  if (explicitEntry !== undefined) return explicitEntry
  const projectRoot = resolve(appPath, '..', '..', '..')
  const sourceEntry = join(projectRoot, 'upstream', SOURCE_HOST_ENTRY)
  if (existsSync(sourceEntry)) return sourceEntry
  // A packaged runtime is available in the product staging tree when the
  // desktop shell is launched from the repository without a built upstream
  // checkout. Keep this fallback local to the development resolver; releases
  // continue to use the packaged source pointer.
  const stagedEntry = join(projectRoot, '.workspace', 'artifacts', 'staging', 'runtime', SOURCE_HOST_ENTRY)
  return existsSync(stagedEntry) ? stagedEntry : sourceEntry
}
