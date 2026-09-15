// ocgo-tab-ring — Client half
// 在会话头部“轨迹”标签右侧注入一个与上下文 ContextMeter 风格一致的进度圈。
// 鼠标悬停显示 OpenCodeGo 额度（优先读取 dsh-ocgo-lite 的 /ocgo-lite/api，
// 拿不到时使用本插件自己的 /ocgo-tab-ring/api）。

window.__ModuleLoader__.load({
  id: 'ocgo-tab-ring',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const SELF_API = '/ocgo-tab-ring/api'
    const LITE_API = '/ocgo-lite/api'

    const CSS = `
.ocgo-tab-ring-root {
  display: inline-flex;
  align-items: center;
  margin-left: 10px;
  position: relative;
  cursor: pointer;
}
.ocgo-tab-ring-root svg {
  display: block;
}
.ocgo-tab-ring-card {
  position: absolute;
  top: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  box-sizing: border-box;
  width: 300px;
  max-width: 90vw;
  padding: 12px 14px;
  border-radius: 14px;
  font-size: 11px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #bbb);
  background:
    radial-gradient(560px circle at 20% 0%, rgba(76,125,255,.12), transparent 45%),
    linear-gradient(145deg, rgba(255,255,255,.08), rgba(255,255,255,.02)),
    var(--dsw-alias-bg-overlay, rgba(20,22,30,.96));
  border: 1px solid rgba(76,125,255,.35);
  box-shadow: 0 18px 48px rgba(0,0,0,.30), 0 0 28px rgba(76,125,255,.14);
  backdrop-filter: blur(26px) saturate(170%);
  -webkit-backdrop-filter: blur(26px) saturate(170%);
  white-space: normal;
}
.ocgo-tab-ring-card-title {
  font-weight: 700;
  font-size: 12px;
  color: var(--dsw-alias-label-primary, #eee);
  margin-bottom: 8px;
}
.ocgo-tab-ring-card-summary {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0 6px;
}
.ocgo-tab-ring-card-window {
  margin-bottom: 8px;
}
.ocgo-tab-ring-card-window-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.ocgo-tab-ring-card-label {
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #eee);
}
.ocgo-tab-ring-card-meta {
  font-variant-numeric: tabular-nums;
}
.ocgo-tab-ring-card-reset {
  color: var(--dsw-alias-label-tertiary, #999);
  font-size: 10px;
}
.ocgo-tab-ring-card-bar {
  height: 5px;
  border-radius: 3px;
  background: rgba(128,128,128,.2);
  overflow: hidden;
  margin-top: 4px;
}
.ocgo-tab-ring-card-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
}
.ocgo-tab-ring-card-foot {
  font-size: 10px;
  opacity: .6;
  margin-top: 6px;
}
.ocgo-tab-ring-card-error {
  color: var(--dsw-alias-state-error-primary, #f66);
  white-space: normal;
}
`

    function fmtPct(n) {
      if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
      return Math.round(Number(n)) + '%'
    }

    function fmtNum(n) {
      if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
      const v = Number(n)
      if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + 'B'
      if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M'
      if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K'
      return String(Math.round(v))
    }

    function fmtUsd(v) {
      if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
      return '$' + Number(v).toFixed(2)
    }

    function fmtReset(iso) {
      if (!iso) return null
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return null
      const diff = d.getTime() - Date.now()
      if (diff <= 0) return '已重置'
      const day = Math.floor(diff / 86400e3)
      const h = Math.floor((diff % 86400e3) / 3600e3)
      const m = Math.floor((diff % 3600e3) / 60e3)
      if (day > 0) return day + ' 天 ' + h + ' 小时'
      if (h > 0) return h + ' 小时 ' + m + ' 分'
      return m + ' 分钟'
    }

    function remainingPercent(w) {
      if (!w) return null
      if (typeof w.percent === 'number') {
        return Math.max(0, Math.min(100, w.status && w.status !== 'ok' ? 0 : 100 - w.percent))
      }
      if (typeof w.limit === 'number' && w.limit > 0 && typeof w.used === 'number') {
        return Math.max(0, Math.min(100, ((w.limit - Math.max(0, w.used)) / w.limit) * 100))
      }
      return null
    }

    function ringColor(p) {
      if (p === null) return 'var(--dsw-alias-label-tertiary, #888)'
      if (p > 50) return 'var(--dsw-alias-state-success-primary, #3fb950)'
      if (p > 20) return 'var(--dsw-alias-state-warn-primary, #d29922)'
      return 'var(--dsw-alias-state-error-primary, #f66)'
    }

    function el(tag, className, text) {
      const node = document.createElement(tag)
      if (className) node.className = className
      if (text !== undefined) node.textContent = text
      return node
    }

    function apply(ctx) {
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => { try { style.remove() } catch { /* ignore */ } }, 'ocgo-tab-ring: css')

      const root = document.createElement('span')
      root.className = 'ocgo-tab-ring-root'
      root.title = 'OpenCodeGo 额度'
      let tip = null
      let timer = null

      function hideTip() {
        if (tip) { tip.remove(); tip = null }
      }

      function showTip(data) {
        hideTip()
        tip = el('div', 'ocgo-tab-ring-tip')
        tip.appendChild(el('div', 'ocgo-tab-ring-tip-title', 'OpenCodeGo 用量'))

        if (!data || !data.ok) {
          const msg = (data && data.error) || '未知错误'
          tip.appendChild(el('div', 'ocgo-tab-ring-tip-error', msg))
          root.appendChild(tip)
          return
        }

        const stats = data.stats
        if (stats) {
          const t = stats.tokens || {}
          const total = (t.input || 0) + (t.output || 0) + (t.reasoning || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0)
          const row = el('div', 'ocgo-tab-ring-tip-row')
          row.appendChild(el('span', 'ocgo-tab-ring-tip-label', 'Token'))
          row.appendChild(el('span', 'ocgo-tab-ring-tip-meta', fmtNum(total)))
          if (typeof stats.cost === 'number') {
            row.appendChild(el('span', 'ocgo-tab-ring-tip-reset', fmtUsd(stats.cost)))
          }
          tip.appendChild(row)
        }

        const quota = data.quota || {}
        const windows = [
          { key: 'rolling', label: '滚动 5h' },
          { key: 'weekly', label: '每周 7d' },
          { key: 'monthly', label: '每月 30d' },
        ]
        for (const w of windows) {
          const item = quota[w.key]
          if (!item) continue
          const rem = remainingPercent(item)
          const row = el('div', 'ocgo-tab-ring-tip-row')
          row.appendChild(el('span', 'ocgo-tab-ring-tip-label', w.label))
          const used = typeof item.percent === 'number' ? Math.round(item.percent) + '%' : '—'
          const remain = rem === null ? '—' : Math.round(rem) + '%'
          row.appendChild(el('span', 'ocgo-tab-ring-tip-meta', `已用 ${used} · 剩余 ${remain}`))
          const reset = fmtReset(item.resetsAt)
          if (reset) row.appendChild(el('span', 'ocgo-tab-ring-tip-reset', reset))
          tip.appendChild(row)
        }

        tip.appendChild(el('div', 'ocgo-tab-ring-tip-hint', '自动读取已配置 Key · 30 秒刷新'))
        root.appendChild(tip)
      }

      function renderRing(data) {
        // 清除旧 ring，只保留提示层由 showTip 管理
        while (root.firstChild) root.removeChild(root.firstChild)

        const quota = (data && data.quota) || {}
        const rems = [quota.rolling, quota.weekly, quota.monthly]
          .map(remainingPercent)
          .filter((v) => v !== null)
        const worst = rems.length ? Math.min(...rems) : null
        const color = ringColor(worst)

        const ns = 'http://www.w3.org/2000/svg'
        const svg = document.createElementNS(ns, 'svg')
        svg.setAttribute('width', '16')
        svg.setAttribute('height', '16')
        svg.setAttribute('viewBox', '0 0 14 14')
        svg.setAttribute('aria-hidden', 'true')

        const track = document.createElementNS(ns, 'circle')
        track.setAttribute('cx', '7')
        track.setAttribute('cy', '7')
        track.setAttribute('r', '5.5')
        track.setAttribute('fill', 'none')
        track.setAttribute('stroke', 'var(--dsw-alias-border-l3, rgba(128,128,128,.35))')
        track.setAttribute('stroke-width', '2')

        const fill = document.createElementNS(ns, 'circle')
        fill.setAttribute('cx', '7')
        fill.setAttribute('cy', '7')
        fill.setAttribute('r', '5.5')
        fill.setAttribute('fill', 'none')
        fill.setAttribute('stroke', color)
        fill.setAttribute('stroke-width', '2')
        fill.setAttribute('stroke-linecap', 'round')
        const C = 2 * Math.PI * 5.5
        const p = worst === null ? 0 : Math.max(0, Math.min(100, worst))
        fill.setAttribute('stroke-dasharray', `${(C * p) / 100} ${C}`)
        fill.setAttribute('transform', 'rotate(-90 7 7)')

        svg.appendChild(track)
        svg.appendChild(fill)
        root.appendChild(svg)

        root.onmouseenter = () => showTip(data)
        root.onmouseleave = hideTip
      }

      function load() {
        // 优先用 dsh-ocgo-lite 的聚合数据，保证悬停内容和它一致；
        // 拿不到时退回本插件自带的配额接口。
        fetch(LITE_API, { headers: { Accept: 'application/json' } })
          .then((r) => {
            if (!r.ok) throw new Error('lite unavailable')
            return r.json()
          })
          .then((data) => {
            if (data && data.ok) {
              renderRing(data)
              return
            }
            return fetch(SELF_API).then((r) => r.json()).then(renderRing)
          })
          .catch(() => {
            fetch(SELF_API)
              .then((r) => r.json())
              .then(renderRing)
              .catch(() => { /* 网络失败保持上次状态 */ })
          })
      }

      function mount() {
        const tablist = document.querySelector('[role="tablist"]')
        if (!tablist) return false
        const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'))
        const trajectoryTab = tabs.find((b) => /轨迹|trajectory/i.test((b.textContent || '').trim()))
        if (trajectoryTab && trajectoryTab.nextSibling) {
          tablist.insertBefore(root, trajectoryTab.nextSibling)
        } else {
          tablist.appendChild(root)
        }
        return true
      }

      let attempts = 0
      function tryMount() {
        if (mount()) {
          load()
          timer = setInterval(load, 30000)
          return
        }
        if (++attempts < 300) setTimeout(tryMount, 100)
      }
      tryMount()

      ctx.effect(() => () => {
        if (timer) clearInterval(timer)
        hideTip()
        try { root.remove() } catch { /* ignore */ }
      }, 'ocgo-tab-ring: cleanup')
    }

    module.exports = {
      apply,
      inject: [],
    }
    return module.exports
  },
})
