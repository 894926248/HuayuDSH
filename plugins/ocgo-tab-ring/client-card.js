// ocgo-tab-ring — Client half (rich popup card, dsh-ocgo-lite style)
// 在“轨迹”标签右侧显示 ContextMeter 风格进度圈；鼠标悬停弹出 OpenCodeGo 用量卡片。
// 数据优先使用 dsh-ocgo-lite 的 /ocgo-lite/api，拿不到时使用本插件自己的 /ocgo-tab-ring/api。

window.__ModuleLoader__.load({
  id: 'ocgo-tab-ring',
  factory: (require) => {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const module = { exports: {} }
    const exports = module.exports

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

    function Ring({ percent, color }) {
      const p = percent == null ? 0 : Math.max(0, Math.min(100, percent))
      const R = 5.5
      const C = 2 * Math.PI * R
      const filled = (p / 100) * C
      return React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 14 14', 'aria-hidden': true },
        React.createElement('circle', { cx: 7, cy: 7, r: R, fill: 'none', stroke: 'var(--dsw-alias-border-l3, rgba(128,128,128,.35))', strokeWidth: 2 }),
        React.createElement('circle', {
          cx: 7, cy: 7, r: R, fill: 'none',
          stroke: color, strokeWidth: 2, strokeLinecap: 'round',
          strokeDasharray: `${C} ${C}`,
          strokeDashoffset: C - filled,
          transform: 'rotate(-90 7 7)',
        }),
      )
    }

    function Card({ data, style }) {
      if (!data || !data.ok) {
        return React.createElement('div', { className: 'ocgo-tab-ring-card' },
          React.createElement('div', { className: 'ocgo-tab-ring-card-title' }, 'OpenCodeGo 用量'),
          React.createElement('div', { className: 'ocgo-tab-ring-card-error' }, (data && data.error) || '未知错误'),
        )
      }

      const stats = data.stats
      const quota = data.quota || {}
      const windows = [
        { key: 'rolling', label: '滚动 5h', color: '#4c7dff' },
        { key: 'weekly', label: '每周 7d', color: '#2fbf71' },
        { key: 'monthly', label: '每月 30d', color: '#e08a3c' },
      ]

      const children = [
        React.createElement('div', { key: 'title', className: 'ocgo-tab-ring-card-title' }, 'OpenCodeGo 用量'),
      ]

      if (stats) {
        const t = stats.tokens || {}
        const total = (t.input || 0) + (t.output || 0) + (t.reasoning || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0)
        children.push(React.createElement('div', { key: 'summary', className: 'ocgo-tab-ring-card-summary' },
          React.createElement('span', { className: 'ocgo-tab-ring-card-label' }, 'Token'),
          React.createElement('span', { className: 'ocgo-tab-ring-card-meta' },
            fmtNum(total) + (typeof stats.cost === 'number' ? ' · ' + fmtUsd(stats.cost) : '')),
        ))
      }

      for (const w of windows) {
        const item = quota[w.key]
        if (!item) continue
        const used = typeof item.percent === 'number' ? Math.round(item.percent) : null
        const rem = remainingPercent(item)
        const reset = fmtReset(item.resetsAt)
        children.push(React.createElement('div', { key: w.key, className: 'ocgo-tab-ring-card-window' },
          React.createElement('div', { className: 'ocgo-tab-ring-card-window-top' },
            React.createElement('span', { className: 'ocgo-tab-ring-card-label' }, w.label),
            React.createElement('span', { className: 'ocgo-tab-ring-card-meta' },
              (used === null ? '—' : used + '% 已用') + ' · 剩余 ' + (rem === null ? '—' : Math.round(rem) + '%')),
            reset ? React.createElement('span', { className: 'ocgo-tab-ring-card-reset' }, '重置 ' + reset) : null,
          ),
          React.createElement('div', { className: 'ocgo-tab-ring-card-bar' },
            React.createElement('i', {
              className: 'ocgo-tab-ring-card-fill',
              style: { width: (used === null ? 0 : Math.min(100, used)) + '%', background: w.color },
            }),
          ),
        ))
      }

      children.push(React.createElement('div', { key: 'foot', className: 'ocgo-tab-ring-card-foot' }, '自动读取已配置 Key · 30 秒刷新'))

      return React.createElement('div', { className: 'ocgo-tab-ring-card' }, children)
    }

    function TabRing() {
      const [data, setData] = React.useState(null)
      const [open, setOpen] = React.useState(false)

      const load = React.useCallback(() => {
        fetch(LITE_API, { headers: { Accept: 'application/json' } })
          .then((r) => {
            if (!r.ok) throw new Error('lite unavailable')
            return r.json()
          })
          .then((body) => {
            if (body && body.ok) {
              setData(body)
              return
            }
            return fetch(SELF_API).then((r) => r.json()).then(setData)
          })
          .catch(() => {
            fetch(SELF_API)
              .then((r) => r.json())
              .then(setData)
              .catch(() => { /* keep last data */ })
          })
      }, [])

      React.useEffect(() => {
        load()
        const timer = setInterval(load, 30000)
        return () => clearInterval(timer)
      }, [load])

      const quota = (data && data.quota) || {}
      const rems = [quota.rolling, quota.weekly, quota.monthly]
        .map(remainingPercent)
        .filter((v) => v !== null)
      const worst = rems.length ? Math.min(...rems) : null

      return React.createElement('span', {
        className: 'ocgo-tab-ring-root',
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
      },
        React.createElement(Ring, { percent: worst, color: ringColor(worst) }),
        open ? React.createElement(Card, { data }) : null,
      )
    }

    function apply(ctx) {
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => { try { style.remove() } catch { /* ignore */ } }, 'ocgo-tab-ring: css')

      let container = null
      let root = null

      function mount() {
        const tablist = document.querySelector('[role="tablist"]')
        if (!tablist) return false
        container = document.createElement('span')
        container.style.cssText = 'display:inline-flex;align-items:center;margin-left:10px;'
        const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'))
        const trajectoryTab = tabs.find((b) => /轨迹|trajectory/i.test((b.textContent || '').trim()))
        if (trajectoryTab && trajectoryTab.nextSibling) {
          tablist.insertBefore(container, trajectoryTab.nextSibling)
        } else {
          tablist.appendChild(container)
        }
        const element = React.createElement(TabRing)
        if (ReactDOM.createRoot) {
          root = ReactDOM.createRoot(container)
          root.render(element)
        } else {
          ReactDOM.render(element, container)
        }
        return true
      }

      let attempts = 0
      function tryMount() {
        if (mount()) return
        if (++attempts < 300) setTimeout(tryMount, 100)
      }
      tryMount()

      ctx.effect(() => () => {
        try {
          if (root) root.unmount()
          else if (container) ReactDOM.unmountComponentAtNode(container)
        } catch { /* ignore */ }
        try { if (container) container.remove() } catch { /* ignore */ }
      }, 'ocgo-tab-ring: cleanup')
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
