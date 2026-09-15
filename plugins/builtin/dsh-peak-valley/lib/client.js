window.__ModuleLoader__.load({
  id: 'dsh-peak-valley',
  factory: require => {
    const React = require('react')
    const h = React.createElement

    const STYLE_ID = 'dsh-peak-valley-style'
    const PEAK_WINDOWS = [[9, 12], [14, 18]]
    const NS = 'dsh-peak-valley'
    const DEEPSEEK_TIME_ZONE = 'Asia/Shanghai'
    const deepSeekClock = new Intl.DateTimeFormat('en-GB', {
      timeZone: DEEPSEEK_TIME_ZONE,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    const inject = ['slots']
    const zh = { nav: '峰谷', title: '峰谷时段', currentPeak: '当前：峰段', currentValley: '当前：谷段' }
    const en = { nav: 'Peak / Valley', title: 'Peak and valley periods', currentPeak: 'Current: peak', currentValley: 'Current: valley' }

    function isDeepSeekPeakHour(hour, weekday) {
      if (weekday === 'Sat' || weekday === 'Sun') return false
      return PEAK_WINDOWS.some(([start, end]) => hour >= start && hour < end)
    }

    function formatHour(hour) {
      return `${String(hour).padStart(2, '0')}:00`
    }

    function deepSeekTime(date) {
      const parts = Object.fromEntries(deepSeekClock.formatToParts(date).map(part => [part.type, part.value]))
      return { hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second), weekday: parts.weekday, text: `${parts.hour}:${parts.minute}:${parts.second}` }
    }

    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
        .dsh-pv-section { width: min(100%, 720px); margin: 0 auto; padding: 26px 30px 30px; box-sizing: border-box; color: var(--dsw-alias-label-primary, #f4f5f6); }
        .dsh-pv-section__title { margin: 0; font-size: 22px; line-height: 30px; font-weight: 600; }
        .dsh-pv-footer { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0 7px; min-width: 0; width: 100%; padding: 6px 10px 7px; box-sizing: border-box; color: var(--dsw-alias-label-secondary, #a8adb3); font-size: 12px; line-height: 18px; }
        .dsh-pv-footer__dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; }
        .dsh-pv-footer__dot.is-peak { background: #e28b43; }
        .dsh-pv-footer__dot.is-valley { background: #359b70; }
        .dsh-pv-footer__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dsh-pv-footer__time { color: var(--dsw-alias-label-primary, #f4f5f6); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .dsh-pv-footer__timeline { grid-column: 1 / -1; position: relative; height: 17px; margin-top: 6px; }
        .dsh-pv-footer__track { position: absolute; inset: 3px 0 auto; display: grid; grid-template-columns: repeat(24, 1fr); column-gap: 2px; height: 11px; overflow: hidden; border-radius: 3px; background: rgb(255 255 255 / 9%); }
        .dsh-pv-footer__track span { display: block; width: auto; min-width: 0; }
        .dsh-pv-footer__track .is-peak { background: #e28b43; }
        .dsh-pv-footer__track .is-valley { background: #359b70; }
        .dsh-pv-footer__marker { position: absolute; top: 0; width: 3px; height: 17px; border-radius: 2px; background: #fff; transform: translateX(-50%); z-index: 2; }
        .dsh-pv-footer__marker::before { content: ''; position: absolute; top: -2px; left: 50%; width: 7px; height: 4px; border-radius: 1px; background: #fff; transform: translateX(-50%); }
        .dsh-pv-footer__marker::after { content: ''; position: absolute; bottom: -2px; left: 50%; width: 7px; height: 4px; border-radius: 1px; background: #fff; transform: translateX(-50%); }
        .dsh-pv-footer__labels { position: absolute; inset: 18px 0 auto; display: flex; justify-content: space-between; color: var(--dsw-alias-label-tertiary, #777d85); font-size: 9px; line-height: 11px; }
        .dsh-pv-section__copy { margin: 7px 0 0; color: var(--dsw-alias-label-secondary, #a8adb3); font-size: 13px; line-height: 20px; }
        .dsh-pv-timeline { margin-top: 26px; padding: 18px; border: 1px solid var(--dsw-alias-border-l2, rgb(255 255 255 / 10%)); border-radius: 9px; background: var(--dsw-alias-fill-secondary, rgb(255 255 255 / 5%)); }
        .dsh-pv-timeline__head, .dsh-pv-timeline__labels { display: flex; align-items: center; justify-content: space-between; color: var(--dsw-alias-label-secondary, #a8adb3); font-size: 12px; line-height: 18px; }
        .dsh-pv-timeline__head strong { color: var(--dsw-alias-label-primary, #f4f5f6); font-weight: 500; }
        .dsh-pv-track { position: relative; height: 9px; margin-top: 14px; border-radius: 999px; background: var(--dsw-alias-fill-tertiary, rgb(255 255 255 / 11%)); }
        .dsh-pv-track__progress { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: #3787f7; transition: width 250ms linear; }
        .dsh-pv-track__marker { position: absolute; top: 50%; width: 15px; height: 15px; border: 3px solid var(--dsw-alias-bg-elevated, #252628); border-radius: 50%; box-sizing: border-box; background: #66a6ff; box-shadow: 0 0 0 2px rgb(55 135 247 / 35%); transform: translate(-50%, -50%); transition: left 250ms linear; }
        .dsh-pv-segments { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); gap: 3px; height: 24px; margin-top: 15px; }
        .dsh-pv-segments span { border-radius: 3px; }
        .dsh-pv-segments .is-peak { background: #e28b43; }
        .dsh-pv-segments .is-valley { background: #359b70; }
        .dsh-pv-timeline__labels { margin-top: 7px; }
        .dsh-pv-legend { display: flex; gap: 18px; margin-top: 18px; color: var(--dsw-alias-label-secondary, #a8adb3); font-size: 12px; line-height: 18px; }
        .dsh-pv-legend span { display: inline-flex; align-items: center; gap: 7px; }
        .dsh-pv-legend i { width: 9px; height: 9px; border-radius: 3px; }
        .dsh-pv-legend .is-peak { background: #e28b43; }
        .dsh-pv-legend .is-valley { background: #359b70; }
        @media (max-width: 680px) { .dsh-pv-section { padding: 22px 20px 24px; } }
        @media (prefers-reduced-motion: reduce) { .dsh-pv-track__progress, .dsh-pv-track__marker { transition: none; } }
      `
      document.head.append(style)
    }

    function PeakValleySection({ t }) {
      const [now, setNow] = React.useState(() => new Date())
      React.useEffect(() => {
        let timer = 0
        const tick = () => {
          setNow(new Date())
          timer = window.setTimeout(tick, 1000)
        }
        timer = window.setTimeout(tick, 1000)
        return () => window.clearTimeout(timer)
      }, [])

      const clock = deepSeekTime(now)
      const currentHour = (clock.hour * 3600000 + clock.minute * 60000 + clock.second * 1000 + now.getMilliseconds()) / 3600000
      const progress = (currentHour / 24) * 100
      const currentPeak = isDeepSeekPeakHour(clock.hour, clock.weekday)
      const segments = []
      for (let hour = 0; hour < 24; hour += 1) {
        segments.push(h('span', {
          key: hour,
          className: isDeepSeekPeakHour(hour, clock.weekday) ? 'is-peak' : 'is-valley',
          title: `${formatHour(hour)}–${formatHour(hour + 1)} ${isDeepSeekPeakHour(hour, clock.weekday) ? '峰段' : '谷段'}`,
        }))
      }

      return h('section', { className: 'dsh-pv-section', 'aria-labelledby': 'dsh-pv-title' },
        h('h2', { id: 'dsh-pv-title', className: 'dsh-pv-section__title' }, t.title),
        h('p', { className: 'dsh-pv-section__copy' }, '实时显示峰段与谷段，进度点跟随当前时间移动。'),
        h('div', { className: 'dsh-pv-timeline' },
          h('div', { className: 'dsh-pv-timeline__head' },
            h('span', null, '24 小时进度'),
            h('strong', null, `${currentPeak ? t.currentPeak : t.currentValley} · ${clock.text}`),
          ),
          h('div', { className: 'dsh-pv-track', role: 'progressbar', 'aria-label': '当前时间进度', 'aria-valuemin': 0, 'aria-valuemax': 24, 'aria-valuenow': currentHour },
            h('span', { className: 'dsh-pv-track__progress', style: { width: `${progress}%` } }),
            h('span', { className: 'dsh-pv-track__marker', style: { left: `${progress}%` }, 'aria-hidden': true }),
          ),
          h('div', { className: 'dsh-pv-segments' }, segments),
          h('div', { className: 'dsh-pv-timeline__labels' }, [0, 6, 12, 18, 24].map(hour => h('span', { key: hour }, formatHour(hour)))),
        ),
        h('div', { className: 'dsh-pv-legend', 'aria-label': '峰谷图例' },
          h('span', null, h('i', { className: 'is-peak', 'aria-hidden': true }), '峰段 09:00–12:00、14:00–18:00（工作日）'),
          h('span', null, h('i', { className: 'is-valley', 'aria-hidden': true }), '谷段 其余时间及周末'),
        ),
      )
    }

    function PeakValleyFooter({ wide }) {
      const [now, setNow] = React.useState(() => new Date())
      React.useEffect(() => {
        let timer = 0
        const tick = () => {
          setNow(new Date())
          timer = window.setTimeout(tick, 1000)
        }
        timer = window.setTimeout(tick, 1000)
        return () => window.clearTimeout(timer)
      }, [])
      const clock = deepSeekTime(now)
      const peak = isDeepSeekPeakHour(clock.hour, clock.weekday)
      const progress = (clock.hour * 3600000 + clock.minute * 60000 + clock.second * 1000 + now.getMilliseconds()) / 864000
      if (!wide) return h('span', { className: `dsh-pv-footer__dot ${peak ? 'is-peak' : 'is-valley'}`, title: peak ? '峰段' : '谷段', 'aria-label': peak ? '峰段' : '谷段' })
      const hours = Array.from({ length: 24 }, (_, hour) => {
        const peakHour = isDeepSeekPeakHour(hour, clock.weekday)
        return h('span', {
          key: hour,
          className: peakHour ? 'is-peak' : 'is-valley',
          title: `${formatHour(hour)} ${peakHour ? '峰段' : '谷段'}`,
        })
      })
      return h('div', { className: 'dsh-pv-footer', 'aria-label': '峰谷当前时段' },
        h('span', { className: `dsh-pv-footer__dot ${peak ? 'is-peak' : 'is-valley'}`, 'aria-hidden': true }),
        h('span', { className: 'dsh-pv-footer__label' }, peak ? '峰段' : '谷段'),
        h('span', { className: 'dsh-pv-footer__time' }, clock.text),
        // 24-hour peak/valley progress axis inside the footer (restored —
        // the CSS for it survived the plugin migration but the render did not).
        h('div', { className: 'dsh-pv-footer__timeline', 'aria-hidden': true },
          h('div', { className: 'dsh-pv-footer__track' }, hours),
          h('span', { className: 'dsh-pv-footer__marker', style: { left: `${progress}%` } }),
        ),
      )
    }

    function apply(ctx) {
      // Settings → 内置插件: off switch means skip all injection. An explicit
      // renderer choice wins (same-origin reloads); only when it is absent does
      // the shell's dsh-disabled param apply (survives host restarts, where
      // localStorage is per-port).
      let off = false
      let decided = false
      try {
        const cached = window.localStorage.getItem('dsh.builtin.dsh-peak-valley.enabled')
        if (cached === '0') { off = true; decided = true }
        else if (cached === '1') decided = true
      } catch { /* storage unavailable */ }
      if (!decided) {
        try {
          const list = new URLSearchParams(window.location.search).get('dsh-disabled')
          if (list !== null && list.split(',').includes('dsh-peak-valley')) off = true
        } catch { /* non-desktop */ }
      }
      if (off) return
      ensureStyles()
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'peak-valley',
        order: 30,
        label: () => '峰谷',
        inject: () => ({ t: zh }),
      }, PeakValleySection))
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'peak-valley-status',
        order: 30,
        label: '峰谷当前时段',
      }, PeakValleyFooter))
    }

    return { apply, inject, name: NS, PeakValleySection }
  },
})
