/**
 * Built-in plugin manager: a Settings section that lists every product
 * built-in plugin with its version, a plain-Chinese explanation of what the
 * feature is for, and an on/off switch.
 *
 * State model (two layers, kept in sync by the shell):
 * - `window.localStorage["dsh.builtin.<id>.enabled"]` — fast same-origin
 *   channel; each built-in plugin's apply() consults it first on reload.
 * - Desktop shell UI-state (`writeUiState`, userData JSON) — survives host
 *   restarts where the renderer origin (and thus localStorage) rotates. The
 *   shell reads it when loading the host page and passes disabled ids in the
 *   `dsh-disabled` query param, which the plugin gates use as their fallback.
 *
 * Effect per plugin kind:
 * - client plugins: reload the host page (same origin) — gates re-evaluate.
 * - host-only plugins (e.g. Command Code provider): full host restart, during
 *   which the shell drops their cordis insert from the runtime patch.
 */
window.__ModuleLoader__.load({
  id: 'dsh-builtin-plugins',
  factory: require => {
    const React = require('react')
    const { useEffect, useState } = React
    const h = React.createElement

    const inject = ['slots']
    const STYLE_ID = 'dsh-builtin-plugins-style'
    const NS = 'dsh-builtin-plugins'
    const ENABLED_PREFIX = 'dsh.builtin.'
    const ENABLED_SUFFIX = '.enabled'
    const desktop = (typeof window !== 'undefined' && window.dshDesktop) || null

    const PLUGINS = [
      { id: 'dsh-peak-valley', name: '峰谷时段提示', version: '0.1.0', why: 'DeepSeek API 按北京时间的峰谷时段计价，谷段成本更低。在侧栏底部常驻显示当前处于「峰段/谷段」及当天走势，方便在低价时段安排重负载任务、控制调用成本。' },
      { id: 'dsh-workspace-performance', name: '界面性能优化（虚拟化）', version: '0.2.0', why: '侧栏会话列表与聊天时间线都利用浏览器原生 content-visibility：屏幕外的条目/消息节点跳过排版与绘制，滚动到才渲染。超大历史会话（数千事件）打开不再长时间卡住，长列表更跟手。' },
      { id: 'dsh-ui-tweaks', name: '界面细节微调', version: '0.1.0', why: '对内置界面做几处顺手的小优化（消息操作按钮排布、折叠区域样式等），让日常浏览操作更舒服；关闭后恢复官方默认外观。' },
      { id: 'dsh-message-edit', name: '消息回编辑', version: '0.1.0', why: '想把某条助手回复改动后重新生成时，通常要复制粘贴。此功能在消息上提供按钮，一键把内容拉回输入框，改完直接发送。' },
      { id: 'dsh-model-settings', name: '模型与密钥设置面板', version: '0.1.0', why: '在设置页集中管理模型与服务商：查看可用模型、填写与测试 API 密钥、设置默认模型，不必翻文档或改配置文件。' },
      { id: 'dsh-model-select-enhanced', name: '模型选择器悬浮增强', version: '0.3.0', why: '渲染与外观保持官方 ui-model-selection 原样，仅对菜单内 role="menuitem" 行叠加更明显的 hover 高亮（官方 token 在菜单表面太淡）。关闭后 hover 回到官方原透明度。' },
      { id: 'dsh-conversation-navigator', name: '长会话步骤导航', version: '0.1.0', why: '长会话（大量工具调用与中间步骤）滚动容易迷路。提供节点式导航，随时定位并跳回某一步骤，回溯上下文更快（Codex 风格）。' },
      { id: 'dsh-commandcode-provider', name: 'Command Code 服务接入', version: '0.1.0', hostOnly: true, why: '内置接入 Command Code 模型服务，让应用可直接使用它执行代码类任务，不必单独配置外部终端。属主机侧服务，关闭需重启会话进程生效。' },
    ]
    const BY_ID = Object.fromEntries(PLUGINS.map(p => [p.id, p]))

    function stateKey(id) {
      return `${ENABLED_PREFIX}${id}${ENABLED_SUFFIX}`
    }

    function localValue(id) {
      try {
        return window.localStorage.getItem(stateKey(id))
      } catch {
        return null
      }
    }

    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
        .dsh-bp-list { display: flex; flex-direction: column; }
        .dsh-bp-row { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-top: 1px solid var(--dsw-alias-border-l2); }
        .dsh-bp-row:first-child { border-top: 0; }
        .dsh-bp-main { flex: 1; min-width: 0; }
        .dsh-bp-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
        .dsh-bp-name { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; }
        .dsh-bp-ver { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
        .dsh-bp-badge { color: var(--dsw-alias-label-secondary); font-size: 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; padding: 0 6px; line-height: 16px; }
        .dsh-bp-why { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.6; margin: 4px 0 0; }

        /* Switch — hardcoded colors + aria-checked fallback so on/off is unambiguous regardless of theme. */
        .dsh-bp-switch { position: relative; flex: 0 0 auto; width: 40px; height: 22px; margin-top: 4px; }
        .dsh-bp-switch input { position: absolute; opacity: 0; inset: 0; cursor: pointer; z-index: 1; }
        .dsh-bp-track { position: absolute; inset: 0; border-radius: 999px; background: #3f4248; transition: background .18s ease; }
        .dsh-bp-track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #f5f5f7; transition: transform .18s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.35); }
        .dsh-bp-switch input:checked + .dsh-bp-track,
        .dsh-bp-switch input[aria-checked="true"] + .dsh-bp-track { background: #2f7cf0; }
        .dsh-bp-switch input:checked + .dsh-bp-track::after,
        .dsh-bp-switch input[aria-checked="true"] + .dsh-bp-track::after { transform: translateX(18px); }
        .dsh-bp-switch input:focus-visible + .dsh-bp-track { box-shadow: 0 0 0 2px rgba(47,124,240,0.45); }

        /* State pill — colored dot + bold label so on/off reads at a glance. */
        .dsh-bp-state-on { color: #2ea043; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; }
        .dsh-bp-state-on::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #2ea043; box-shadow: 0 0 0 2px rgba(46,160,67,0.18); }
        .dsh-bp-state-off { color: #c0524c; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; }
        .dsh-bp-state-off::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #c0524c; box-shadow: 0 0 0 2px rgba(192,82,76,0.18); }
      `
      document.head.append(style)
    }

    function isEnabledFromValues(persisted, local, defaultOff = false) {
      if (persisted === '0' || persisted === '1') return persisted !== '0'
      if (local === '0' || local === '1') return local !== '0'
      return !defaultOff
    }

    function BuiltinPluginsManager() {
      const [flags, setFlags] = useState(() => Object.fromEntries(PLUGINS.map(p => [p.id, p.defaultOff !== true])))
      const [hint, setHint] = useState(null)

      // Reflect persisted shell state (survives host restarts); local storage
      // is the synchronous fallback (web mode has no desktop bridge).
      useEffect(() => {
        let cancelled = false
        const load = async () => {
          const next = {}
          for (const p of PLUGINS) {
            let persisted = null
            if (desktop) {
              try {
                persisted = await desktop.readUiState(stateKey(p.id))
              } catch { /* read failure — fall through to local */ }
            }
            next[p.id] = isEnabledFromValues(persisted, localValue(p.id), p.defaultOff === true)
          }
          if (!cancelled) setFlags(next)
        }
        void load()
        return () => { cancelled = true }
      }, [])

      const toggle = async (id, next) => {
        const plugin = BY_ID[id]
        try {
          window.localStorage.setItem(stateKey(id), next ? '1' : '0')
        } catch { /* storage unavailable */ }
        setFlags(f => ({ ...f, [id]: next }))
        if (desktop) {
          try {
            // Flush before any reload/restart so the shell reads fresh state.
            await desktop.writeUiState(stateKey(id), next ? '1' : '0')
          } catch { /* persistence failure — local copy still applies */ }
        }
        const verb = next ? '已开启' : '已关闭'
        if (plugin.hostOnly) {
          setHint(`「${plugin.name}」${verb}，正在重启会话进程使主机侧服务生效…`)
          if (desktop) {
            desktop.restartHost()
          } else {
            window.location.reload()
          }
        } else {
          setHint(`「${plugin.name}」${verb}，刷新界面后生效。`)
          if (desktop) {
            desktop.reloadHostPage()
          } else {
            window.location.reload()
          }
        }
      }

      return h('div', { className: 'dsh-bp-list' },
        h('p', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px', margin: '0 0 4px' } },
          '内置插件由产品外壳注入与管理。开关即时保存（重启应用后仍保留）；关闭后对应功能停止注入。'),
        PLUGINS.map(p => h('div', { key: p.id, className: 'dsh-bp-row' },
          h('div', { className: 'dsh-bp-main' },
            h('div', { className: 'dsh-bp-head' },
              h('span', { className: 'dsh-bp-name' }, p.name),
              h('span', { className: 'dsh-bp-ver' }, `v${p.version}`),
              p.hostOnly === true && h('span', { className: 'dsh-bp-badge' }, '主机服务'),
              h('span', { className: flags[p.id] ? 'dsh-bp-state-on' : 'dsh-bp-state-off' }, flags[p.id] ? '运行中' : '已停用'),
            ),
            h('p', { className: 'dsh-bp-why' }, p.why),
          ),
          h('label', { className: 'dsh-bp-switch' },
            h('input', {
              type: 'checkbox',
              checked: flags[p.id],
              'aria-checked': flags[p.id],
              onChange: e => toggle(p.id, e.target.checked),
              'aria-label': `${p.name}开关`,
            }),
            h('span', { className: 'dsh-bp-track' }),
          ),
        )),
        hint !== null && h('div', { style: { marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px' } },
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } }, hint),
        ),
      )
    }

    function apply(ctx) {
      ensureStyles()
      // Mount as a third tab inside the official Plugins section rather than a
      // top-level settings entry. Order 20 places it directly after the stock
      // "插件列表" tab (which registers at order 10).
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
        {
          name: 'settings.plugins.tab',
          id: 'builtin-plugins',
          order: 20,
          label: () => '内置插件',
          locale: NS,
          inject: () => ({}),
        },
        BuiltinPluginsManager,
      ))
    }

    return { name: 'dsh-builtin-plugins', inject, apply }
  },
})
