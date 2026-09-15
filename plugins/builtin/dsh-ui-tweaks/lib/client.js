/**
 * Browser half: inject the independent UI style tweaks that previously lived
 * in CSS overlay files. Pure stylesheet injection — no component, no upstream
 * file touched. Selectors prefer stable data-attributes; css-module class
 * names are matched by substring (the hashed class keeps the original token).
 *
 * Sources (overlay files, now plugin-shaped):
 * - MessageIconActions.module.css: hover reveal of message actions
 * - GenericCommandCard.module.css: sweep animation via transform (no layout
 *   thrash from animating `left`)
 */
window.__ModuleLoader__.load({
  id: 'dsh-ui-tweaks',
  factory: () => {
    const STYLE_ID = 'dsh-ui-tweaks-style'

    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
        /* MessageIconActions: actions appear on row hover / focus. */
        [data-time-hover-root] [data-message-actions] {
          opacity: 0;
          pointer-events: none;
          transition: opacity 140ms ease;
        }
        [data-time-hover-root]:hover [data-message-actions],
        [data-time-hover-root]:focus-within [data-message-actions] {
          opacity: 1;
          pointer-events: auto;
        }

        /* GenericCommandCard: running-row sweep via transform (GPU-friendly). */
        [class*="root"][data-state="running"] [class*="row"]::after {
          will-change: transform;
        }
        @keyframes dsh-command-row-sweep {
          0% { transform: translateX(-300px); }
          90%, 100% { transform: translateX(calc(100vw + 300px)); }
        }

        /* ReasoningRow: same transform-based sweep (own keyframe name). */
        @keyframes dsh-reasoning-row-sweep {
          0% { transform: translateX(-300px); }
          90%, 100% { transform: translateX(calc(100vw + 300px)); }
        }

        /* Layout (F03): center column background + no auto-collapse below 1024px. */
        [class*="centerCol"] {
          position: relative;
          background: var(--dsw-alias-bg-base);
        }
        @media (max-width: 1024px) {
          [class*="sidebarCol"] { display: flex !important; }
        }

        /* InputBar (composer card surface) via stable data anchors. */
        @font-face {
  font-family: 'DshChipCell';
  src: url('data:font/ttf;base64,AAEAAAAKAIAAAwAgT1MvMkT8SmIAAAEoAAAAYGNtYXAADQBPAAABkAAAADRnbHlmAAAAAAAAAcwAAAABaGVhZCwtPGoAAACsAAAANmhoZWEDIg7bAAAA5AAAACRobXR4EZQAAAAAAYgAAAAIbG9jYQAAAAAAAAHEAAAABm1heHAAAwACAAABCAAAACBuYW1lvljk2gAAAdAAAABscG9zdNNweNQAAAI8AAAALQABAAAAAQAAdia1tV8PPPUAAwPoAAAAAOaLfcUAAAAA5ot9xQAAAAAAAAAAAAAAAwACAAAAAAAAAAEAAAMg/zgAAA+gAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAACAAEAAAACAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwjKAZAABQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAPz8/PwAA//z//AMg/zgAAAMgAMgAAAAAAAAAAAAAAAAAAAAgAAAB9AAAD6AAAAAAAAIAAAADAAAAFAADAAEAAAAUAAQAIAAAAAQABAABAAD//P//AAD//P//AAUAAQAAAAAAAAAAAAAAAAAAAAAAAAAEADYAAQAAAAAAAQALAAAAAQAAAAAAAgAHAAsAAwABBAkAAQAWABIAAwABBAkAAgAOAChEc2hDaGlwQ2VsbFJlZ3VsYXIARABzAGgAQwBoAGkAcABDAGUAbABsAFIAZQBnAHUAbABhAHIAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAABAgZvYmpyZXAAAAA=') format('truetype');
}
        [data-composer-card] {
          box-sizing: border-box;
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
          max-width: var(--dsh-composer-card-max-width);
          padding: 10px 0 4px;
          border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2-darkmode-thin) 72%, transparent);
          border-radius: 22px;
          background: var(--dsw-specific-input-major);
          box-shadow: var(--dsw-shadow-lv1);
          transition: border-color 120ms ease, box-shadow 120ms ease;
          font-size: 16px;
          line-height: 24px;
        }
        [data-composer-card]:focus-within {
          border-color: var(--dsw-alias-border-l3);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-border-l3) 54%, transparent), var(--dsw-shadow-lv1);
        }

        /* Desktop version chip: the shell's fixed drag strip overlays the
           sidebar brand row, so the chip's covered part was consumed as a
           window-drag area — no click, no pointer cursor. Lift the chip in
           case the strip is the blocker (position/z-index only, no
           typography); the click pad below is the layer-agnostic backstop. */
        body[data-dsh-desktop] .dsh-desktop-version-badge {
          position: relative;
          z-index: 2147483646;
        }
            `
      document.head.append(style)
    }

    /**
     * Click pad for the version chip. The shell pins a fixed drag region over
     * the top of the window; whenever it (or any other overlay) covers the
     * chip, presses there start a window drag instead of a click, so the
     * chip's hit area is only partially alive. A transparent, no-drag pad
     * pinned to the chip's live rect — appended last, so it wins paint order
     * in the body stacking context — owns the whole rect and forwards clicks
     * to the chip. The pad is 0x0 until the chip exists and never covers
     * anything but the chip's own rectangle.
     */
    function installVersionChipPad() {
      const PAD_ID = 'dsh-ui-tweaks-version-pad'
      if (document.getElementById(PAD_ID) !== null) return
      if (document.body.dataset.dshDesktop !== 'true'
        && document.documentElement.dataset.dshDesktop !== 'true') return
      const pad = document.createElement('div')
      pad.id = PAD_ID
      pad.setAttribute('aria-hidden', 'true')
      pad.style.cssText = [
        'position:fixed', 'left:0', 'top:0', 'width:0', 'height:0',
        'z-index:2147483647', 'cursor:pointer', 'background:transparent',
      ].join(';')
      pad.style.setProperty('-webkit-app-region', 'no-drag')
      const chip = () => document.querySelector('.dsh-desktop-version-badge')
      // Duck-typed: works in the renderer and stays probe-friendly.
      const isElement = value => value !== null && typeof value === 'object'
        && typeof value.getBoundingClientRect === 'function'
      const place = () => {
        const target = chip()
        if (!isElement(target)) { pad.style.width = '0px'; pad.style.height = '0px'; return }
        const rect = target.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) { pad.style.width = '0px'; pad.style.height = '0px'; return }
        pad.style.left = `${String(Math.round(rect.left))}px`
        pad.style.top = `${String(Math.round(rect.top))}px`
        pad.style.width = `${String(Math.round(rect.width))}px`
        pad.style.height = `${String(Math.round(rect.height))}px`
      }
      pad.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        const target = chip()
        if (isElement(target) && typeof target.click === 'function') target.click()
      })
      document.body.append(pad)
      place()
      window.addEventListener('resize', place)
      window.addEventListener('scroll', place, true)
      window.setInterval(place, 700)
    }

    function apply() {
      // Settings → 内置插件: off switch means skip all injection. An explicit
      // renderer choice wins (same-origin reloads); only when it is absent does
      // the shell's dsh-disabled param apply (survives host restarts, where
      // localStorage is per-port).
      let off = false
      let decided = false
      try {
        const cached = window.localStorage.getItem('dsh.builtin.dsh-ui-tweaks.enabled')
        if (cached === '0') { off = true; decided = true }
        else if (cached === '1') decided = true
      } catch { /* storage unavailable */ }
      if (!decided) {
        try {
          const list = new URLSearchParams(window.location.search).get('dsh-disabled')
          if (list !== null && list.split(',').includes('dsh-ui-tweaks')) off = true
        } catch { /* non-desktop */ }
      }
      if (off) return
      ensureStyles()
      installVersionChipPad()
    }

    return { name: 'dsh-ui-tweaks', inject: [], apply }
  },
})
