/** Host loader entry for the browser implementation exported from `./client`. */

import type { Context } from '@deepseek-ai/cordis'
import { installLiveModelDiscovery } from './live-discovery.ts'

/** Host entry: add live provider directories behind the existing LLM seam. */
export function apply(ctx: Context): void {
  installLiveModelDiscovery(ctx)
}
