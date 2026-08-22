const DSH_BOOT_MARKER = 'window.__DSH_BOOT__'

/**
 * Identify the HTML document served by a compatible Harness Web host.
 * @param contentType - Response content type from the candidate URL.
 * @param document - Complete response text from the candidate URL.
 * @returns Whether the response is the Harness boot document.
 */
export function isDshWebHostDocument(contentType: string | null, document: string): boolean {
  return contentType?.toLowerCase().includes('text/html') === true
    && document.includes(DSH_BOOT_MARKER)
}

/**
 * Identify a successful Harness Web response, including its HTTP status.
 * @param status - HTTP status returned by the candidate loopback server.
 * @param contentType - Response content type.
 * @param document - Complete response text.
 * @returns Whether the response can be loaded as the Harness Web document.
 */
export function isDshWebHostResponse(status: number, contentType: string | null, document: string): boolean {
  return status >= 200 && status < 300 && isDshWebHostDocument(contentType, document)
}
