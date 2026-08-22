import { join, resolve } from 'node:path'

/** Relative path of the built CLI entry that owns the Web profile. */
export const SOURCE_HOST_ENTRY = join('apps', 'cli', 'lib', 'bin.js')

/** Relative path of the CLI entry inside the deployed production closure. */
export const PACKAGED_HOST_ENTRY = join('lib', 'bin.js')

/** Resource directory used for the complete upstream runtime in a release. */
export const PACKAGED_HOST_PAYLOAD = 'dsh-host-payload'

/**
 * Resolve the source checkout's CLI entry from Electron's development app root.
 * @param appPath - Electron's un-packaged application directory.
 * @param explicitEntry - Optional deployment override for the CLI entry.
 * @param sourceRoot - Optional prepared official source root used by a product build.
 * @returns the absolute CLI entry path used by the embedded profile.
 */
export function resolveDevelopmentHostEntry(appPath: string, explicitEntry?: string, sourceRoot?: string): string {
  return explicitEntry ?? join(sourceRoot ?? resolve(appPath, '..', '..', '..', 'upstream'), SOURCE_HOST_ENTRY)
}

/**
 * Resolve the CLI entry from a release payload under Electron resources.
 * @param resourcesPath - Electron's resource directory.
 * @param explicitEntry - Optional deployment override for the materialized host.
 * @returns The absolute CLI entry path used by the packaged shell.
 */
export function resolvePackagedHostEntry(resourcesPath: string, explicitEntry?: string): string {
  return explicitEntry ?? join(resourcesPath, PACKAGED_HOST_PAYLOAD, SOURCE_HOST_ENTRY)
}
