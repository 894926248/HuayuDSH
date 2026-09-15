import type { Context } from '@deepseek-ai/cordis'

export const name = 'template-plugin'

export function apply(ctx: Context): void {
  // 在这里通过 ctx 注册工具、事件、服务等。
  // 例如：export const inject = ['tools'] 后使用 ctx.tools.register(...)。
}