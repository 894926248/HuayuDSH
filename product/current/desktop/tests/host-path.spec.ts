import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDevelopmentHostEntry, SOURCE_HOST_ENTRY } from '../src/host-path.ts'

describe('resolveDevelopmentHostEntry', () => {
  it('resolves the official checkout from Electron app root', () => {
    const appPath = join('C:', 'checkout', 'apps', 'desktop')

    expect(resolveDevelopmentHostEntry(appPath)).toBe(join(resolve(appPath, '..', '..', '..', 'upstream'), SOURCE_HOST_ENTRY))
  })

  it('honors a prepared source root for a product build', () => {
    expect(resolveDevelopmentHostEntry('C:/product/current/desktop', undefined, 'C:/staging/source'))
      .toBe(join('C:/staging/source', SOURCE_HOST_ENTRY))
  })

  it('honors an explicit entry override', () => {
    const explicitEntry = join('D:', 'harness', 'apps', 'cli', 'lib', 'bin.js')

    expect(resolveDevelopmentHostEntry(join('C:', 'checkout', 'apps', 'desktop'), explicitEntry)).toBe(explicitEntry)
  })
})
