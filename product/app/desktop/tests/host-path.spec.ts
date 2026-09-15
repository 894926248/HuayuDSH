import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDevelopmentHostEntry, SOURCE_HOST_ENTRY } from '../src/host-path.ts'

describe('resolveDevelopmentHostEntry', () => {
  it('resolves the checkout from Electron app root', () => {
    const appPath = join('C:', 'checkout', 'product', 'app', 'desktop')

    expect(resolveDevelopmentHostEntry(appPath)).toBe(join(resolve(appPath, '..', '..', '..', 'upstream'), SOURCE_HOST_ENTRY))
  })

  it('honors an explicit entry override', () => {
    const explicitEntry = join('D:', 'harness', 'apps', 'cli', 'lib', 'bin.js')

    expect(resolveDevelopmentHostEntry(join('C:', 'checkout', 'product', 'app', 'desktop'), explicitEntry)).toBe(explicitEntry)
  })
})
