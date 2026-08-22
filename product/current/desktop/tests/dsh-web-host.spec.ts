import { describe, expect, it } from 'vitest'
import { isDshWebHostDocument, isDshWebHostResponse } from '../src/dsh-web-host.ts'

describe('isDshWebHostDocument', () => {
  it('accepts the Harness boot HTML document', () => {
    expect(isDshWebHostDocument('text/html; charset=utf-8', '<script>window.__DSH_BOOT__ = {}</script>')).toBe(true)
    expect(isDshWebHostDocument('text/html; charset=utf-8', '<script>globalThis["__DSH_BOOT__"] = {}</script>')).toBe(true)
  })

  it('rejects an unrelated response on the default port', () => {
    expect(isDshWebHostDocument('application/json', '{"status":"ok"}')).toBe(false)
    expect(isDshWebHostDocument('text/html', '<main>Other application</main>')).toBe(false)
  })

  it('requires a successful HTTP status before accepting the boot document', () => {
    const document = '<script>window.__DSH_BOOT__ = {}</script>'
    expect(isDshWebHostResponse(200, 'text/html', document)).toBe(true)
    expect(isDshWebHostResponse(404, 'text/html', document)).toBe(false)
    expect(isDshWebHostResponse(503, 'text/html', document)).toBe(false)
  })
})
