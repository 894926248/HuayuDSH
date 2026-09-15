/**
 * Browser half: hover-flyout companion for the OFFICIAL model picker.
 *
 * The official ui-model-selection menu shows two root cells (模型 / 推理等级).
 * This plugin does NOT shadow `conversation.input.model` — upstream keeps
 * rendering its own trigger, chevron, and two-level menu. We only add one
 * global behaviour: when the pointer hovers one of those two root cells, a
 * small flyout panel appears at the LEFT of that cell, showing the same
 * content the user would otherwise have to click into (model list with
 * collapsible provider groups, or reasoning-effort list for the current
 * model). Move the pointer off the cell (and off the flyout) and it closes.
 *
 * No class-name clash with upstream: we add `id="dsh-ms-panel"` outside
 * upstream's component tree and style it under `data-dsh-ms-panel` attributes.
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-select-enhanced',
  factory: () => {
    // The loader hands factory the module `require`; the plugin context (with
    // modelDirectories / sessions) arrives later in apply(ctx).
    let appCtx = null
    const inject = ['slots', 'modelDirectories', 'sessions']
    const STYLE_ID = 'dsh-ms-flyout-style'
    const PANEL_ID = 'dsh-ms-panel'
    const COLLAPSED_KEY = 'dsh-ms.collapsed'

    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
        [data-dsh-ms-panel] {
          position: fixed;
          z-index: 61;
          display: flex;
          flex-direction: column;
          width: max-content;
          min-width: 240px;
          max-width: 360px;
          max-height: min(360px, calc(100vh - 32px));
          padding: 4px;
          border: 1px solid var(--dsw-alias-border-inverted, rgba(255,255,255,0.12));
          border-radius: 12px;
          background: var(--dsw-specific-menu, #1e1e1e);
          box-shadow: var(--dsw-shadow-lv3, 0 8px 30px rgb(0 0 0 / 30%));
          color: var(--dsw-alias-label-primary, #f4f5f6);
          font-size: 13px;
          overflow: hidden;
        }
        [data-dsh-ms-panel] [data-dsh-ms-panel-head] {
          position: sticky;
          top: 0;
          padding: 6px 10px;
          background: var(--dsw-specific-menu, #1e1e1e);
          color: var(--dsw-alias-label-tertiary, #a8adb3);
          font-size: 12px;
          font-weight: 500;
        }
        [data-dsh-ms-panel] [data-dsh-ms-panel-body] {
          overflow-y: auto;
          min-height: 0;
          padding: 2px;
        }
        [data-dsh-ms-panel] [data-dsh-ms-group] { margin-top: 2px; }
        [data-dsh-ms-panel] [data-dsh-ms-group-name] {
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          width: 100%;
          padding: 5px 10px 3px;
          color: var(--dsw-alias-label-tertiary, #a8adb3);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          user-select: none;
        }
        [data-dsh-ms-panel] [data-dsh-ms-group-name]:hover { color: var(--dsw-alias-label-secondary, #a8adb3); }
        [data-dsh-ms-panel] [data-dsh-ms-fold] {
          color: var(--dsw-alias-label-caption, #777d85);
          font-size: 10px;
          width: 12px;
          text-align: right;
        }
        [data-dsh-ms-panel] [data-dsh-ms-model] {
          box-sizing: border-box;
          display: flex;
          align-items: center;
          gap: 8px;
          width: auto;
          min-width: 100%;
          min-height: 32px;
          padding: 4px 10px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: inherit;
          text-align: left;
          font: inherit;
          cursor: pointer;
        }
        [data-dsh-ms-panel] [data-dsh-ms-model]:hover,
        [data-dsh-ms-panel] [data-dsh-ms-model]:focus-visible {
          background: rgb(255 255 255 / 11%);
        }
        [data-dsh-ms-panel] [data-dsh-ms-model].is-current { color: var(--dsw-alias-label-primary, #f4f5f6); font-weight: 600; }
        [data-dsh-ms-panel] [data-dsh-ms-check] {
          margin-left: auto;
          color: var(--dsw-alias-label-primary, #f4f5f6);
        }
        [data-dsh-ms-panel] [data-dsh-ms-effort] {
          box-sizing: border-box;
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          height: 32px;
          padding: 0 10px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: inherit;
          text-align: left;
          font: inherit;
          cursor: pointer;
        }
        [data-dsh-ms-panel] [data-dsh-ms-effort]:hover { background: rgb(255 255 255 / 11%); }
        [data-dsh-ms-panel] [data-dsh-ms-effort].is-current { font-weight: 600; }
        [data-dsh-ms-panel] [data-dsh-ms-empty] {
          padding: 10px;
          color: var(--dsw-alias-label-tertiary, #a8adb3);
          font-size: 12px;
        }
      `
      document.head.append(style)
    }

    function el(tag, attrs = {}, ...children) {
      const node = document.createElement(tag)
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue
        if (k === 'class') node.className = v
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v)
        else if (k === 'text') node.textContent = v
        else node.setAttribute(k, String(v))
      }
      for (const c of children.flat()) {
        if (c == null) continue
        node.append(c instanceof Node ? c : document.createTextNode(String(c)))
      }
      return node
    }

    function loadCollapsed() {
      try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')) }
      catch { return new Set() }
    }
    function saveCollapsed(set) {
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set])) } catch { /* storage unavailable */ }
    }

    function activeSessionId() {
      try {
        const list = appCtx && appCtx.sessions ? appCtx.sessions.list.getSnapshot() : null
        // SessionListState shape: { current: SessionId, sessions: SessionEntry[] }
        const cur = list && list.current
        if (cur) return cur
        if (list && Array.isArray(list.sessions) && list.sessions.length > 0) {
          return list.sessions[0].id
        }
      } catch { /* sessions unavailable this cycle */ }
      return undefined
    }

    function getSnapshot() {
      const sid = activeSessionId()
      if (sid === undefined) return null
      try {
        const directory = appCtx && appCtx.modelDirectories ? appCtx.modelDirectories.directoryFor(sid) : null
        if (!directory || !directory.store) return null
        return directory.store.getSnapshot()
      } catch { return null }
    }

    /** The active session's directory wrapper ({store, load, select}) or null. */
    function getDirectory() {
      const sid = activeSessionId()
      if (sid === undefined) return null
      try {
        return appCtx && appCtx.modelDirectories ? appCtx.modelDirectories.directoryFor(sid) : null
      } catch { return null }
    }

    function findReasoning(current, state) {
      if (!current || !state || !state.groups) return null
      for (const g of state.groups) {
        if (g.id !== current.provider) continue
        for (const m of g.models) {
          if (m.id === current.model) return m.reasoning
        }
      }
      return null
    }

    function renderModelBody(current, collapsed, onToggle, onPick) {
      const body = el('div', { 'data-dsh-ms-panel-body': '' })
      const state = getSnapshot()
      if (!state || !state.groups || state.groups.length === 0) {
        // Fresh host boot: the catalog is still building — show a loading
        // hint instead of the misleading "no models" dead end. The store
        // subscription in showPanel fills the list in when it arrives.
        const waiting = !state || state.status === 'loading' || state.status === 'idle'
        body.append(el('div', { 'data-dsh-ms-empty': '', text: waiting ? '加载中…' : '暂无模型' }))
        return body
      }
      for (const group of state.groups) {
        const isCollapsed = collapsed.has(group.id)
        const sec = el('div', { 'data-dsh-ms-group': '' })
        const head = el('div', { 'data-dsh-ms-group-name': '', role: 'button' },
          el('span', { text: (group.name || group.label || group.title || group.id || '(unnamed)') + ` (${(group.models || []).length})` }),
          el('span', { 'data-dsh-ms-fold': '', text: isCollapsed ? '▸' : '▾' }),
        )
        head.addEventListener('click', () => onToggle(group.id))
        sec.append(head)
        if (!isCollapsed) {
          for (const model of group.models) {
            const isCurrent = current && current.provider === group.id && current.model === model.id
            const btn = el('button', { 'data-dsh-ms-model': '', title: model.name },
              el('span', { text: model.name }),
              isCurrent ? el('span', { 'data-dsh-ms-check': '', text: '✓' }) : null,
            )
            if (isCurrent) btn.classList.add('is-current')
            btn.addEventListener('click', async () => { await onPick(group, model) })
            sec.append(btn)
          }
        }
        body.append(sec)
      }
      return body
    }

    function renderEffortBody(current, onPick) {
      const body = el('div', { 'data-dsh-ms-panel-body': '' })
      const state = getSnapshot()
      const reasoning = findReasoning(current, state)
      const reasoningEffort = current ? current.reasoningEffort : undefined
      const effectiveEffort = reasoningEffort !== undefined ? reasoningEffort : (reasoning && reasoning.defaultEffort)
      if (!reasoning) {
        body.append(el('div', { 'data-dsh-ms-empty': '', text: '当前模型无推理等级设置' }))
        return body
      }
      const choices = []
      if (reasoning.defaultEffort === undefined) {
        choices.push({ key: 'default', label: '默认', effort: undefined })
      }
      for (const e of reasoning.efforts || []) {
        choices.push({ key: e.id, label: e.name, effort: e.id })
      }
      if (choices.length === 0) {
        body.append(el('div', { 'data-dsh-ms-empty': '', text: '暂无可选等级' }))
        return body
      }
      for (const c of choices) {
        const isCurrent = effectiveEffort === c.effort
        const btn = el('button', { 'data-dsh-ms-effort': '' },
          el('span', { text: c.label }),
          isCurrent ? el('span', { 'data-dsh-ms-check': '', text: '✓' }) : null)
        if (isCurrent) btn.classList.add('is-current')
        btn.addEventListener('click', () => {
          if (!current) return
          // Close first, select in background — the network round-trip must
          // not hold the menu open.
          closeOfficialMenu()
          hidePanel()
          const dir = appCtx && appCtx.modelDirectories ? appCtx.modelDirectories.directoryFor(activeSessionId()) : null
          if (!dir) return
          void dir.select({ provider: current.provider, model: current.model, reasoningEffort: c.effort }).catch(() => { /* surfaced on store */ })
        })
        body.append(btn)
      }
      return body
    }

    let closeTimer = null
    let panelSeq = 0
    let hoveredCell = null
    let switchTimer = null
    let safePolygon = null
    let lastPointerX = -1
    let lastPointerY = -1
    let movePrevX = -1
    let movePrevY = -1
    let moveLastX = -1
    let moveLastY = -1
    let moveLastT = 0
    // Ask the official picker to close itself: upstream listens for a
    // mousedown outside its root and folds the menu. We synthesize one after
    // a successful pick so the whole frame (not just the flyout) collapses.
    function closeOfficialMenu() {
      try { document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) } catch { /* ignore */ }
    }
    function scheduleClose() {
      if (closeTimer) clearTimeout(closeTimer)
      closeTimer = setTimeout(hidePanel, 180)
    }
    // Convex-quad point-in-polygon (sign of successive cross products).
    function pointInPolygon(px, py, pts) {
      let sign = 0
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i]
        const [x2, y2] = pts[(i + 1) % pts.length]
        const cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)
        if (cross !== 0) {
          const s = cross > 0 ? 1 : -1
          if (sign === 0) sign = s
          else if (s !== sign) return false
        }
      }
      return true
    }
    function hidePanel() {
      panelSeq++ // invalidate any live store subscription for the dead panel
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
      if (switchTimer) { clearTimeout(switchTimer); switchTimer = null }
      hoveredCell = null
      safePolygon = null
      // Sweep ALL panel instances — id-based removal could leave a duplicate
      // behind if two panels were ever created back-to-back.
      for (const existing of document.querySelectorAll(`[data-dsh-ms-panel]`)) existing.remove()
    }
    function showPanel(cell) {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
      const label = (cell.textContent || '').replace(/\s+/g, '')
      const isModel = label.includes('模型')
      const isEffort = label.includes('推理')
      if (!isModel && !isEffort) { hidePanel(); return }
      hidePanel()
      const state = getSnapshot() || {}
      const current = state.current || null
      const collapsed = loadCollapsed()
      const headText = isModel ? '选择模型' : '推理等级'
      // Position-critical styles are applied AT CREATION, before anything can
      // throw: a panel that ever reached the DOM without them would render as
      // an unstyled full-width block at the end of the page (user-visible
      // as a stray strip below the app). Offscreen until measured.
      const panel = el('div', { id: PANEL_ID, 'data-dsh-ms-panel': '' },
        el('div', { 'data-dsh-ms-panel-head': '', text: headText }),
      )
      panel.style.position = 'fixed'
      panel.style.left = '-9999px'
      panel.style.top = '-9999px'
      panel.style.width = '280px'
      panel.style.boxSizing = 'border-box'
      panel.style.overflow = 'hidden'
      panel.style.zIndex = '60'
      let body = isModel
        ? renderModelBody(current, collapsed,
            (gid) => { const next = new Set(loadCollapsed()); if (next.has(gid)) next.delete(gid); else next.add(gid); saveCollapsed(next); showPanel(cell) },
            (group, model) => {
              // Close first, select in background — no network-wait before
              // the menus collapse.
              closeOfficialMenu()
              hidePanel()
              const dir = appCtx && appCtx.modelDirectories ? appCtx.modelDirectories.directoryFor(activeSessionId()) : null
              if (!dir) return
              void dir.select({ provider: group.id, model: model.id }).catch(() => { /* surfaced on store */ })
            })
        : renderEffortBody(current)
      panel.append(body)
      // Flyout opens to the LEFT of the whole model-picker frame, with its
      // BOTTOM edge flush against the frame's bottom edge (grows upward).
      const menuFrame = cell.closest('[role="menu"]')
      const frameRect = (menuFrame || cell).getBoundingClientRect()
      const panelWidth = 280
      const maxPanelHeight = 400
      const minEdge = 8
      // Right edge of the panel sits 4px off the frame's left edge — the
      // mainstream cascade gap (macOS submenu / VS Code / Figma use 4-6px):
      // keeps both rounded corners and shadows visible instead of butting
      // them into each other.
      let left = frameRect.left - 4 - panelWidth
      if (left < minEdge) left = minEdge
      // Height adapts to content; 360px cap (the size the user approved),
      // further clamped by the space above the frame's bottom edge. Content
      // is built synchronously, so one measurement after append is exact.
      const available = Math.min(360, frameRect.bottom - minEdge)
      panel.style.left = `${left}px`
      panel.style.height = 'auto'
      panel.style.maxHeight = `${available}px`
      document.body.append(panel)
      const measured = panel.offsetHeight
      panel.style.top = `${frameRect.bottom - measured}px`
      panel.addEventListener('pointerenter', () => {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
        // Pointer reached the panel — any pending switch is moot.
        if (switchTimer) { clearTimeout(switchTimer); switchTimer = null }
      })
      panel.addEventListener('pointerleave', () => scheduleClose())
      // Live fill: right after a host restart the catalog may still be
      // building when the panel first renders (加载中…). Subscribe to the
      // directory store and re-render the body in place — also re-pinning
      // the bottom alignment, since the panel height changes. panelSeq
      // invalidates the subscription as soon as the panel closes/rebuilds.
      const dir = getDirectory()
      if (dir && dir.store && typeof dir.store.subscribe === 'function') {
        const store = dir.store
        const mySeq = ++panelSeq
        let lastVersion = null
        const rerender = () => {
          if (panelSeq !== mySeq) { unsub(); return }
          const snap = store.getSnapshot() || {}
          const version = JSON.stringify([
            snap.status,
            snap.current,
            (snap.groups || []).map(g => [g.id, (g.models || []).map(m => m.id)]),
          ])
          if (version === lastVersion) return
          lastVersion = version
          if (!document.getElementById(PANEL_ID)) return
          const fresh = isModel
            ? renderModelBody(snap.current || null, loadCollapsed(),
                (gid) => { const next = new Set(loadCollapsed()); if (next.has(gid)) next.delete(gid); else next.add(gid); saveCollapsed(next); showPanel(cell) },
                (group, model) => {
                  closeOfficialMenu()
                  hidePanel()
                  const d = getDirectory()
                  if (d) void d.select({ provider: group.id, model: model.id }).catch(() => { /* surfaced on store */ })
                })
            : renderEffortBody(snap.current || null)
          body.replaceWith(fresh)
          body = fresh
          panel.style.maxHeight = `${Math.min(360, frameRect.bottom - minEdge)}px`
          const remeasured = panel.offsetHeight
          panel.style.top = `${frameRect.bottom - remeasured}px`
        }
        const unsub = store.subscribe(rerender)
        // Kick a load if the store never started (status stuck at idle).
        const snapNow = store.getSnapshot()
        if (snapNow && snapNow.status === 'idle' && typeof dir.load === 'function') {
          try { dir.load().catch(() => { /* surfaced on store */ }) } catch { /* already loading */ }
        }
      }
    }

    function onPointerOver(event) {
      lastPointerX = event.clientX
      lastPointerY = event.clientY
      const cell = event.target.closest && event.target.closest('[role="menuitem"]')
      if (!cell) return
      const root = cell.closest('[role="menu"]')
      if (!root) return
      // Only the FIRST level of menuitems (root pane two cells). Sub-pane
      // options and effort rows are not menuitems upstream, but defensively
      // cap to direct children of a role=menu parent.
      const parent = cell.parentElement
      if (!parent || parent.getAttribute('role') !== 'menu') return
      // Hover-intent (VS Code / macOS pattern): the FIRST open is instant;
      // switching to the OTHER cell requires a ~120ms dwell, so the pointer
      // merely passing over a row on the way to the flyout doesn't flip the
      // panel. Re-entering the same cell is a no-op.
      if (hoveredCell === cell) return
      if (switchTimer) { clearTimeout(switchTimer); switchTimer = null }
      hoveredCell = cell
      const panelOpen = !!document.getElementById(PANEL_ID)
      if (!panelOpen) {
        showPanel(cell)
        return
      }
      // Safe corridor (Amazon-menu pattern): the quadrilateral spanning from
      // this cell's left edge to the flyout's right edge covers every
      // reasonable path toward the flyout — including ones that clip the
      // other row. Pointer inside it → keep the current panel.
      const panel = document.getElementById(PANEL_ID)
      const cellRect = cell.getBoundingClientRect()
      if (panel) {
        const pRect = panel.getBoundingClientRect()
        safePolygon = [
          [cellRect.left, cellRect.top],
          [pRect.right, Math.min(pRect.top, cellRect.top)],
          [pRect.right, Math.max(pRect.bottom, cellRect.bottom)],
          [cellRect.left, cellRect.bottom],
        ]
      } else {
        safePolygon = null
      }
      switchTimer = setTimeout(checkSwitch, 120)
      function checkSwitch() {
        switchTimer = null
        if (hoveredCell !== cell || !cell.isConnected) return
        const r = cell.getBoundingClientRect()
        const inside = lastPointerX >= r.left && lastPointerX <= r.right
          && lastPointerY >= r.top && lastPointerY <= r.bottom
        if (!inside) return
        // Inside the corridor toward the flyout → keep waiting; settled
        // outside it → this is a real switch.
        if (safePolygon && pointInPolygon(lastPointerX, lastPointerY, safePolygon)) {
          switchTimer = setTimeout(checkSwitch, 80)
          return
        }
        showPanel(cell)
      }
    }

    // Deterministic close paths: the pointerout-based timer misses the case
    // where the official menu tears its cells out of the DOM (outside click /
    // Escape) — then pointerover/out never fire and the flyout would linger.
    function onPointerDown(event) {
      const target = event.target
      const inMenu = target.closest && target.closest('[role="menu"]')
      const inPanel = target.closest && target.closest(`#${PANEL_ID}`)
      // Pressing a model/effort ROW inside the flyout starts collapsing the
      // official frame at pointerdown (same instant the stock cells react) —
      // not at click time, which lagged by the full press-release cycle.
      if (inPanel && target.closest('[data-dsh-ms-model],[data-dsh-ms-effort]')) {
        closeOfficialMenu()
        return
      }
      if (!inMenu && !inPanel) hidePanel()
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') hidePanel()
    }
    function onPointerMove(event) {
      movePrevX = moveLastX
      movePrevY = moveLastY
      moveLastX = event.clientX
      moveLastY = event.clientY
      moveLastT = performance.now()
    }
    // Clicking a root-pane cell must NOT drill into the official sub-pane —
    // the hover flyout already shows that content; letting the click through
    // stacks the official list on top of the flyout.
    function onCellClickCapture(event) {
      const cell = event.target.closest && event.target.closest('[role="menuitem"]')
      if (!cell) return
      if (cell.closest(`#${PANEL_ID}`)) return
      const inMenu = cell.closest('[role="menu"]')
      const parent = cell.parentElement
      if (inMenu && parent && parent.getAttribute('role') === 'menu') {
        event.stopPropagation()
        event.preventDefault()
      }
    }

    function apply(ctx) {
      appCtx = ctx
      let off = false
      let decided = false
      try {
        const cached = localStorage.getItem('dsh.builtin.dsh-model-select-enhanced.enabled')
        if (cached === '0') { off = true; decided = true }
        else if (cached === '1') decided = true
      } catch { /* storage unavailable */ }
      if (!decided) {
        try {
          const list = new URLSearchParams(window.location.search).get('dsh-disabled')
          if (list !== null && list.split(',').includes('dsh-model-select-enhanced')) off = true
        } catch { /* non-desktop */ }
      }
      if (off) return
      ensureStyles()
      document.addEventListener('pointerover', onPointerOver, true)
      document.addEventListener('pointermove', onPointerMove, true)
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('keydown', onKeyDown, true)
      document.addEventListener('click', onCellClickCapture, true)
    }

    return { name: 'dsh-model-select-enhanced', inject, apply }
  },
})