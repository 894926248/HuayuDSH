/**
 * Browser half: a fixed, non-scrolling marker rail mounted through the
 * conversation input dock. The rail owns its overflow wheel, while clicks
 * delegate only the target transcript row to the conversation scrollport.
 */
window.__ModuleLoader__.load({
  id: 'dsh-conversation-navigator',
  factory: require => {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const {
      Fragment,
      createElement: h,
      useCallback,
      useEffect,
      useLayoutEffect,
      useMemo,
      useRef,
      useState,
      useSyncExternalStore,
    } = React

    const PROJECTION_KEY = 'dshConversationNavigator'
    const RAIL_WIDTH = 40
    const MARKER_STEP = 12
    const MAX_HISTORY_PASSES = 180
    const EMPTY_STORE = { getSnapshot: () => undefined, subscribe: () => () => {} }
    const DEFAULT_NODE_LENGTH = 8
    const WHEEL_STEP = 80
    const EDGE_FADE_SLOTS = 2
    const MARKER_CENTER_OFFSET = DEFAULT_NODE_LENGTH / 2
    const EMPHASIS_LENGTHS = [30, 23, 17, 12, 8]
    const EMPHASIS_OPACITIES = [1, 0.94, 0.88, 0.82, 0.76]
    const EMPHASIS_RADIUS = EMPHASIS_LENGTHS.length - 1

    const css = `
      .dsh-cn-root {
        position: fixed;
        z-index: 200;
        width: ${RAIL_WIDTH}px;
        height: var(--dsh-cn-height, 72dvh);
        box-sizing: border-box;
        color: var(--dsw-alias-label-dimmed, rgba(150, 154, 162, .64));
        pointer-events: auto;
        overscroll-behavior: contain;
        user-select: none;
        touch-action: none;
        -webkit-user-select: none;
      }
      .dsh-cn-rail {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        width: 100%;
        height: 100%;
      }
      .dsh-cn-track {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        width: 100%;
      }
      .dsh-cn-viewport {
        position: absolute;
        inset: 0;
        z-index: 2;
        overflow: hidden;
        pointer-events: auto;
        -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 5%, #000 95%, transparent 100%);
        mask-image: linear-gradient(to bottom, transparent 0%, #000 5%, #000 95%, transparent 100%);
      }
      .dsh-cn-nodes {
        position: absolute;
        top: calc(50% - 8px);
        left: 0;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        width: 100%;
        height: max-content;
        margin: 0;
        padding: 0;
        list-style: none;
        pointer-events: none;
        transform: translateY(calc(-1 * var(--dsh-cn-node-offset, 0px)));
        transition: transform 180ms ease-out;
        will-change: transform;
      }
      .dsh-cn-item {
        position: relative;
        flex: 0 0 ${MARKER_STEP}px;
        width: 100%;
        height: ${MARKER_STEP}px;
        pointer-events: none;
      }
      .dsh-cn-node {
        position: absolute;
        top: 50%;
        left: 0;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        width: ${RAIL_WIDTH + 16}px;
        height: 16px;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: var(--dsw-alias-label-dimmed, rgba(150, 154, 162, .64));
        cursor: pointer;
        pointer-events: auto;
        transform: translateY(-50%);
        transition: color 180ms ease-out;
      }
      .dsh-cn-node:active { transform: translateY(-50%); }
      .dsh-cn-node:focus-visible {
        outline: 2px solid var(--dsw-alias-label-primary, rgba(245, 246, 248, .94));
        outline-offset: 2px;
      }
      .dsh-cn-line {
        display: block;
        width: ${RAIL_WIDTH}px;
        height: 3px;
        margin-left: 0;
        border-radius: 0;
        background: var(--dsw-alias-label-dimmed, rgba(150, 154, 162, .64));
        opacity: var(--dsh-cn-opacity, .64);
        transform: scaleX(var(--dsh-cn-scale, .225)) scaleY(var(--dsh-cn-thickness, .667));
        transform-origin: left center;
        transition: transform 140ms ease-out, opacity 140ms ease-out, background-color 140ms ease-out, box-shadow 140ms ease-out;
      }
      .dsh-cn-node[data-active] .dsh-cn-line {
        background: var(--dsw-alias-label-primary, rgba(245, 246, 248, .94));
        opacity: 1;
        transform: scaleX(${DEFAULT_NODE_LENGTH / RAIL_WIDTH}) scaleY(var(--dsh-cn-thickness, .667));
        box-shadow: none;
      }
      .dsh-cn-node[data-emphasis-center] .dsh-cn-line {
        background: var(--dsw-alias-label-secondary, rgba(192, 196, 203, .86));
        opacity: 1;
        transform: scaleX(var(--dsh-cn-scale, .225)) scaleY(var(--dsh-cn-thickness, 1));
        box-shadow: none;
      }
      .dsh-cn-preview {
        position: absolute;
        top: clamp(72px, calc(50% + var(--dsh-cn-preview-offset, 0px)), calc(100% - 72px));
        left: var(--dsh-cn-preview-left, calc(100% + 14px));
        z-index: 8;
        width: var(--dsh-cn-preview-width, min(180px, 30vw));
        min-height: 96px;
        box-sizing: border-box;
        padding: 10px 12px;
        overflow: hidden;
        border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .16));
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2, rgba(39, 40, 44, .98));
        box-shadow: var(--dsw-shadow-lv3, 0 10px 30px rgba(0, 0, 0, .24));
        color: var(--dsw-alias-label-primary, #f2f4f6);
        opacity: 1;
        pointer-events: none;
        transform: translateY(-50%) translateX(-4px);
        animation: dsh-cn-preview-in 180ms ease-out forwards;
      }
      .dsh-cn-preview-head {
        display: block;
        overflow: hidden;
        color: var(--dsw-alias-label-primary, #f2f4f6);
        font-size: 14px;
        font-weight: 600;
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-cn-preview-text {
        display: -webkit-box;
        overflow: hidden;
        margin: 6px 0 0;
        color: var(--dsw-alias-label-secondary, #c0c4cb);
        font-size: 13px;
        line-height: 1.4;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
      }
      @keyframes dsh-cn-preview-in {
        from { opacity: 1; }
        to { opacity: 1; transform: translateY(-50%) translateX(0); }
      }
      .dsh-cn-jump-flash {
        animation: dsh-cn-jump-flash 900ms ease-out;
      }
      @keyframes dsh-cn-jump-flash {
        0%, 100% { box-shadow: none; }
        32% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--dsw-alias-label-primary, #f5f6f8) 22%, transparent); }
      }
      @media (max-width: 720px) {
        .dsh-cn-root { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .dsh-cn-node, .dsh-cn-line, .dsh-cn-preview, .dsh-cn-nodes, .dsh-cn-jump-flash {
          transition: none;
          animation: none;
        }
      }
    `

    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-dsh-conversation-navigator]') !== null) return
      const style = document.createElement('style')
      style.dataset.dshConversationNavigator = ''
      style.textContent = css
      document.head.appendChild(style)
    }

    function textOf(content) {
      if (!Array.isArray(content)) return ''
      let text = ''
      for (const block of content) {
        if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') text += block.text
      }
      return text.trim().slice(0, 120)
    }

    function normalize(message) {
      if (message === null || typeof message !== 'object' || typeof message.seq !== 'number') return null
      return {
        seq: message.seq,
        time: typeof message.time === 'number' ? message.time : 0,
        text: typeof message.text === 'string' ? message.text : '',
        ...(typeof message.id === 'string' ? { id: message.id } : {}),
        ...(typeof message.key === 'string' ? { key: message.key } : {}),
      }
    }

    function collectFromNodes(snapshot) {
      const out = []
      const nodes = snapshot?.chat?.nodes
      if (nodes === undefined || typeof nodes.values !== 'function') return out
      for (const node of nodes.values()) {
        if (node?.kind !== 'user' || node.data === null || typeof node.data !== 'object') continue
        if (typeof node.data.time !== 'number' || !Array.isArray(node.data.content)) continue
        if (typeof node.key !== 'string') continue
        out.push({ seq: node.anchorSeq, time: node.data.time, text: textOf(node.data.content), key: node.key })
      }
      return out.sort((a, b) => a.seq - b.seq)
    }

    function keyOf(message) {
      if (typeof message.key === 'string' && message.key !== '') return message.key
      if (typeof message.id === 'string' && message.id !== '') return `13:input-message${message.id}`
      return undefined
    }

    function reducedMotion() {
      return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }

    function emphasisDistance(index, centerIndex) {
      if (centerIndex < 0) return null
      const distance = Math.abs(index - centerIndex)
      return distance <= EMPHASIS_RADIUS ? distance : null
    }

    function nodeOffset(index, centerIndex) {
      return (index - centerIndex) * MARKER_STEP
    }

    function visibleSlotsForHeight(height) {
      const slots = Math.floor((height - MARKER_STEP * EDGE_FADE_SLOTS) / MARKER_STEP)
      const odd = slots - (slots % 2 === 0 ? 1 : 0)
      return Math.max(1, odd)
    }

    function fallbackVisibleSlots() {
      if (typeof window === 'undefined') return 1
      return visibleSlotsForHeight(window.innerHeight * 0.72)
    }

    function centeredIndex(total, selected, visibleSlots) {
      if (total <= 1 || total <= visibleSlots) return (total - 1) / 2
      const radius = Math.floor((visibleSlots - 1) / 2)
      return Math.max(radius, Math.min(total - 1 - radius, selected))
    }

    function clampCenterIndex(total, center, visibleSlots) {
      if (total <= 1 || total <= visibleSlots) return (total - 1) / 2
      const radius = Math.floor((visibleSlots - 1) / 2)
      return Math.max(radius, Math.min(total - 1 - radius, Math.round(center)))
    }

    function revealIndex(total, index, center, visibleSlots) {
      if (total <= 1 || total <= visibleSlots) return (total - 1) / 2
      const radius = Math.floor((visibleSlots - 1) / 2)
      const minimum = center - radius
      const maximum = center + radius
      if (index < minimum) return clampCenterIndex(total, index + radius, visibleSlots)
      if (index > maximum) return clampCenterIndex(total, index - radius, visibleSlots)
      return center
    }

    function nodeOpacity(index, centerIndex) {
      if (centerIndex < 0 || !Number.isInteger(centerIndex)) return 0.64
      const distance = Math.abs(index - centerIndex)
      const emphasisOpacity = EMPHASIS_OPACITIES[distance]
      if (emphasisOpacity !== undefined) return emphasisOpacity
      return Math.max(0.42, 0.76 - Math.min(distance - EMPHASIS_RADIUS, 12) * 0.025)
    }

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

    function snapshotContainsMessage(snapshot, message, key) {
      const nodes = snapshot?.chat?.nodes
      if (nodes?.get(key) !== undefined) return true
      if (nodes === undefined || typeof nodes.values !== 'function') return false
      for (const node of nodes.values()) {
        if (node?.anchorSeq === message.seq || node?.data?.id === message.id) return true
      }
      return false
    }

    async function jumpToMessage(sessions, sessionId, message) {
      const session = sessions.binding(sessionId)?.session
      if (session === undefined) return false
      const key = keyOf(message)
      if (key === undefined) return false
      let pass = 0
      while (pass++ < MAX_HISTORY_PASSES) {
        const snapshot = session.getSnapshot()
        if (snapshotContainsMessage(snapshot, message, key)) break
        if (snapshot?.hasMore !== true) return false
        if (snapshot.loadingOlder === true) {
          await delay(24)
          continue
        }
        await session.loadOlder()
      }
      const scrollport = document.querySelector('[data-conversation-scroll]')
      if (scrollport === null) return false
      // Paging updates the session store before React has committed the new
      // rows. Give the transcript a couple of frames to expose the anchor.
      let row = null
      for (let frame = 0; frame < 8 && row === null; frame += 1) {
        row = scrollport.querySelector(`[data-chat-anchor-key="${CSS.escape(key)}"]`)
        if (row === null) await delay(24)
      }
      if (row === null || row === undefined) return false
      // Scroll only the conversation host. `Element.scrollIntoView()` is
      // allowed to move an outer document/side pane when the transcript is
      // nested, which is the jump the navigator must avoid.
      const scrollRect = scrollport.getBoundingClientRect()
      const rowRect = row.getBoundingClientRect()
      const target = scrollport.scrollTop + rowRect.top - scrollRect.top
        - Math.max(0, (scrollRect.height - rowRect.height) / 2)
      scrollport.scrollTo({
        top: Math.max(0, Math.min(scrollport.scrollHeight - scrollport.clientHeight, target)),
        behavior: reducedMotion() ? 'auto' : 'smooth',
      })
      row.classList.add('dsh-cn-jump-flash')
      window.setTimeout(() => row.classList.remove('dsh-cn-jump-flash'), 900)
      return true
    }

    function railGeometry() {
      const scrollport = document.querySelector('[data-conversation-scroll]')
      if (scrollport === null) return null
      const scrollRect = scrollport.getBoundingClientRect()
      if (scrollRect.width <= 0 || scrollRect.height <= 0) return null
      const column = scrollport.querySelector('[data-chat-flow]')
      const columnRect = column?.getBoundingClientRect()
      const gutterCenter = columnRect !== undefined && columnRect.left > scrollRect.left
        ? (scrollRect.left + columnRect.left) / 2
        : scrollRect.left - 30
      const height = Math.max(1, Math.min(window.innerHeight * 0.72, scrollRect.height))
      const unclampedTop = scrollRect.top + (scrollRect.height - height) / 2
      const top = Math.max(0, Math.min(window.innerHeight - height, unclampedTop))
      const left = Math.max(4, Math.min(window.innerWidth - RAIL_WIDTH - 4, gutterCenter - MARKER_CENTER_OFFSET))
      return { left, top, height, center: gutterCenter }
    }

    function activeIndexOf(messages) {
      const scrollport = document.querySelector('[data-conversation-scroll]')
      if (scrollport === null || messages.length === 0) return -1
      const rect = scrollport.getBoundingClientRect()
      const atBottom = scrollport.scrollTop + scrollport.clientHeight >= scrollport.scrollHeight - 8
      const line = rect.top + rect.height * 0.42
      const byKey = new Map(messages.map((message, index) => [keyOf(message), index]))
      let best = -1
      let distance = Infinity
      for (const row of scrollport.querySelectorAll('[data-chat-flow-kind="user"]')) {
        const key = row.getAttribute('data-chat-anchor-key')
        const index = byKey.get(key)
        if (index === undefined) continue
        const rowRect = row.getBoundingClientRect()
        const nextDistance = Math.abs(rowRect.top + rowRect.height / 2 - line)
        if (nextDistance < distance) {
          distance = nextDistance
          best = index
        }
      }
      if (atBottom) {
        return messages.length - 1
      }
      return best
    }

    function labelOf(message, index, total, t) {
      return `${t('user')} ${index + 1}/${total}`
    }

    function nodeKey(message, index) {
      return keyOf(message) ?? `${message.seq}:${message.id ?? index}`
    }

    function Navigator({ sessionId, useProjection, sessions, t }) {
      const projected = useProjection(PROJECTION_KEY)
      const session = sessionId === undefined ? undefined : sessions.binding(sessionId)?.session
      const hasProjection = Array.isArray(projected?.messages) && projected.messages.length > 0
      // A complete host projection is independent of assistant streaming. Do
      // not subscribe the rail to every token once that projection is ready.
      const store = hasProjection ? EMPTY_STORE : session ?? EMPTY_STORE
      // Session store methods use their instance as `this`; wrap them before
      // handing them to React so updates keep the runtime notifier attached.
      const subscribe = useCallback(listener => store.subscribe(listener), [store])
      const getSnapshot = useCallback(() => store.getSnapshot(), [store])
      const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      const messages = useMemo(() => {
        const fromProjection = hasProjection
          ? projected.messages.map(normalize).filter(Boolean).sort((a, b) => a.seq - b.seq)
          : []
        return fromProjection.length > 0 ? fromProjection : collectFromNodes(snapshot)
      }, [hasProjection, projected, snapshot])
      const [geometry, setGeometry] = useState(null)
      const [activeIndex, setActiveIndex] = useState(-1)
      const [hoveredKey, setHoveredKey] = useState(null)
      const [selectedKey, setSelectedKey] = useState(null)
      const [scrollCenterIndex, setScrollCenterIndex] = useState(null)
      const [visibleSlots, setVisibleSlots] = useState(fallbackVisibleSlots)
      const previousSessionId = useRef(sessionId)
      const previousLength = useRef(messages.length)
      const frame = useRef(null)
      const rootRef = useRef(null)
      const viewportRef = useRef(null)
      const wheelDelta = useRef(0)
      const wheelHandlerRef = useRef(() => {})

      const hasRenderableSession = sessionId !== undefined

      useEffect(() => { installStyles() }, [])

      useEffect(() => {
        if (session === undefined) return undefined
        let cancelled = false
        let loading = false

        // The host projection is the complete rail index, but the Session
        // still owns a paged transcript window. Keep the two in sync after
        // open/resync so a stream retry cannot reset the body to the tail
        // while the rail continues to show older messages.
        const load = async () => {
          if (loading || cancelled) return
          loading = true
          try {
            let pass = 0
            while (!cancelled && pass++ < MAX_HISTORY_PASSES) {
              const current = session.getSnapshot()
              if (current?.openState === 'error') break
              if (current?.openState !== 'open' || current.loadingOlder === true) {
                await delay(40)
                continue
              }
              if (current.hasMore !== true) break
              await session.loadOlder()
              // A failed page is fail-soft and leaves hasMore true. Yield
              // before the next attempt instead of spinning a tight retry.
              await delay(40)
            }
          } finally {
            loading = false
          }
        }

        const unsubscribe = session.subscribe(() => {
          const current = session.getSnapshot()
          if (current?.openState === 'open' && current.hasMore === true && current.loadingOlder !== true) {
            void load()
          }
        })
        void load()
        return () => {
          cancelled = true
          unsubscribe()
        }
      }, [sessionId, session])

      useLayoutEffect(() => {
        const viewport = viewportRef.current
        if (viewport === null || typeof ResizeObserver === 'undefined') return undefined
        const update = () => {
          const next = visibleSlotsForHeight(viewport.clientHeight)
          setVisibleSlots(current => current === next ? current : next)
        }
        update()
        const observer = new ResizeObserver(update)
        observer.observe(viewport)
        return () => observer.disconnect()
      }, [messages.length, geometry?.height])

      const measure = useCallback(() => {
        if (frame.current !== null) return
        frame.current = window.requestAnimationFrame(() => {
          frame.current = null
          const next = railGeometry()
          setGeometry(previous => previous !== null && next !== null
            && previous.left === next.left && previous.top === next.top && previous.height === next.height
            ? previous
            : next)
          setActiveIndex(previous => {
            const nextIndex = activeIndexOf(messages)
            return previous === nextIndex ? previous : nextIndex
          })
        })
      }, [messages])

      useEffect(() => {
        measure()
        const scrollport = document.querySelector('[data-conversation-scroll]')
        const onScroll = () => { measure() }
        const onResize = () => { measure() }
        scrollport?.addEventListener('scroll', onScroll, { passive: true })
        window.addEventListener('resize', onResize)
        const observer = typeof ResizeObserver === 'undefined' || scrollport === null ? null : new ResizeObserver(measure)
        if (observer !== null) observer.observe(scrollport)
        const timer = window.setInterval(measure, 500)
        return () => {
          scrollport?.removeEventListener('scroll', onScroll)
          window.removeEventListener('resize', onResize)
          observer?.disconnect()
          window.clearInterval(timer)
          if (frame.current !== null) window.cancelAnimationFrame(frame.current)
          frame.current = null
        }
      }, [sessionId, messages.length, measure])

      useEffect(() => {
        const sessionChanged = previousSessionId.current !== sessionId
        const messagesChanged = previousLength.current !== messages.length
        if (sessionChanged) {
          setHoveredKey(null)
          setSelectedKey(null)
          setScrollCenterIndex(null)
        } else if (messagesChanged) {
          setHoveredKey(null)
          setScrollCenterIndex(value => value === null
            ? value
            : clampCenterIndex(messages.length, value, visibleSlots))
        }
        previousSessionId.current = sessionId
        previousLength.current = messages.length
      }, [messages.length, sessionId, visibleSlots])

      const passiveIndex = activeIndex >= 0 ? activeIndex : (messages.length > 0 ? 0 : -1)
      const clickedIndex = selectedKey === null
        ? -1
        : messages.findIndex((message, index) => nodeKey(message, index) === selectedKey)
      const hoveredIndex = hoveredKey === null
        ? -1
        : messages.findIndex((message, index) => nodeKey(message, index) === hoveredKey)
      const selectedIndex = hoveredIndex >= 0
        ? hoveredIndex
        : (clickedIndex >= 0 ? clickedIndex : passiveIndex)
      const focusIndex = clickedIndex >= 0 ? clickedIndex : passiveIndex
      const initialCenterIndex = centeredIndex(messages.length, focusIndex, visibleSlots)
      const centerIndex = scrollCenterIndex === null
        ? initialCenterIndex
        : clampCenterIndex(messages.length, scrollCenterIndex, visibleSlots)
      const previewNode = hoveredKey === null
        ? null
        : messages.find((message, index) => nodeKey(message, index) === hoveredKey) ?? null
      const previewIndex = previewNode === null ? -1 : messages.indexOf(previewNode)
      const previewWidth = Math.min(180, window.innerWidth - 24)
      const previewLeft = geometry !== null && geometry.left - previewWidth - 10 >= 8
        ? -(previewWidth + 10)
        : RAIL_WIDTH + 10

      const choose = useCallback((index, focus = false) => {
        const bounded = Math.max(0, Math.min(index, messages.length - 1))
        const message = messages[bounded]
        if (message === undefined) return
        const key = nodeKey(message, bounded)
        setSelectedKey(key)
        const nextCenter = revealIndex(messages.length, bounded, centerIndex, visibleSlots)
        setScrollCenterIndex(nextCenter)
        if (focus) rootRef.current?.querySelector(`[data-dsh-cn-node="${CSS.escape(key)}"]`)?.focus()
        void jumpToMessage(sessions, sessionId, message)
      }, [centerIndex, messages, sessionId, sessions, visibleSlots])

      const handleWheel = useCallback(event => {
        event.preventDefault()
        event.stopPropagation()
        if (messages.length <= visibleSlots || event.deltaY === 0) return
        wheelDelta.current += event.deltaY
        const steps = Math.trunc(Math.abs(wheelDelta.current) / WHEEL_STEP)
        if (steps === 0) return
        const direction = wheelDelta.current > 0 ? 1 : -1
        wheelDelta.current -= direction * steps * WHEEL_STEP
        const nextCenter = clampCenterIndex(
          messages.length,
          centerIndex + direction * Math.min(steps, 6),
          visibleSlots,
        )
        if (nextCenter === centerIndex) return
        setHoveredKey(null)
        setSelectedKey(null)
        setScrollCenterIndex(nextCenter)
      }, [centerIndex, messages.length, visibleSlots])
      wheelHandlerRef.current = handleWheel

      useLayoutEffect(() => {
        const root = rootRef.current
        const ownerWindow = root?.ownerDocument.defaultView ?? null
        if (root === null || ownerWindow === null || messages.length === 0) return undefined
        const onWheel = event => {
          if (event.deltaY === 0 && event.deltaX === 0) return
          if (!(event.target instanceof ownerWindow.Element) || !root.contains(event.target)) return
          wheelHandlerRef.current(event)
          event.stopImmediatePropagation()
        }
        ownerWindow.addEventListener('wheel', onWheel, { capture: true, passive: false })
        return () => ownerWindow.removeEventListener('wheel', onWheel, true)
      }, [messages.length])

      const buttonFromTarget = target => {
        if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return null
        return target.closest('[data-dsh-cn-node]')
      }
      const handleClick = event => {
        const button = buttonFromTarget(event.target)
        const index = button === null ? NaN : Number(button.getAttribute('data-node-index'))
        if (Number.isInteger(index)) choose(index)
      }
      const handlePointerOver = event => {
        const button = buttonFromTarget(event.target)
        if (button === null) return
        const related = event.relatedTarget
        if (typeof Node !== 'undefined' && related instanceof Node && button.contains(related)) return
        setHoveredKey(button.getAttribute('data-dsh-cn-node'))
      }
      const handlePointerOut = event => {
        const button = buttonFromTarget(event.target)
        if (button === null) return
        const related = event.relatedTarget
        if (typeof Node !== 'undefined' && related instanceof Node && button.contains(related)) return
        const key = button.getAttribute('data-dsh-cn-node')
        setHoveredKey(current => current === key ? null : current)
      }
      const handleFocus = event => {
        const button = buttonFromTarget(event.target)
        if (button !== null) setHoveredKey(button.getAttribute('data-dsh-cn-node'))
      }
      const handleBlur = event => {
        const button = buttonFromTarget(event.target)
        if (button === null) return
        const related = event.relatedTarget
        if (typeof Node !== 'undefined' && related instanceof Node && button.contains(related)) return
        const key = button.getAttribute('data-dsh-cn-node')
        setHoveredKey(current => current === key ? null : current)
      }
      const handleKeyDown = event => {
        const button = buttonFromTarget(event.target)
        const index = button === null ? NaN : Number(button.getAttribute('data-node-index'))
        if (!Number.isInteger(index)) return
        let next
        if (event.key === 'ArrowUp') next = index - 1
        else if (event.key === 'ArrowDown') next = index + 1
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = messages.length - 1
        else return
        event.preventDefault()
        choose(next, true)
      }

      if (!hasRenderableSession || geometry === null || messages.length === 0) return null
      const previewText = previewNode === null ? '' : previewNode.text || t('noText')
      const previewTitle = previewText.length > 54 ? `${previewText.slice(0, 54)}...` : previewText
      const previewId = previewNode === null ? undefined : `dsh-conversation-node-preview-${previewIndex}`

      return ReactDOM.createPortal(
        h('nav', {
          ref: rootRef,
          className: 'dsh-cn-root',
          style: {
            left: geometry.left,
            top: geometry.top,
            height: geometry.height,
            '--dsh-cn-height': `${geometry.height}px`,
          },
          role: 'navigation',
          'aria-label': t('rail'),
          onWheelCapture: handleWheel,
        },
        h('div', { className: 'dsh-cn-rail' },
          h('div', { className: 'dsh-cn-track', 'data-node-count': messages.length },
            h('div', {
              ref: viewportRef,
              className: 'dsh-cn-viewport',
              'data-visible-node-slots': visibleSlots,
            },
            h('ol', {
              className: 'dsh-cn-nodes',
              style: { '--dsh-cn-node-offset': `${centerIndex * MARKER_STEP}px` },
              onClick: handleClick,
              onPointerOver: handlePointerOver,
              onPointerOut: handlePointerOut,
              onFocusCapture: handleFocus,
              onBlurCapture: handleBlur,
              onKeyDown: handleKeyDown,
            }, messages.map((message, index) => {
              const key = nodeKey(message, index)
              const selected = index === selectedIndex
              const distance = emphasisDistance(index, previewIndex >= 0 ? previewIndex : -1)
              const emphasisCenter = distance === 0 && hoveredIndex >= 0
              const effectiveDistance = selected && !emphasisCenter ? null : distance
              const label = labelOf(message, index, messages.length, t)
              return h('li', {
                key,
                className: 'dsh-cn-item',
                style: {
                  '--dsh-cn-scale': `${(effectiveDistance === null ? DEFAULT_NODE_LENGTH : EMPHASIS_LENGTHS[effectiveDistance] ?? DEFAULT_NODE_LENGTH) / 40}`,
                  '--dsh-cn-opacity': nodeOpacity(index, previewIndex >= 0 ? previewIndex : -1),
                  '--dsh-cn-thickness': emphasisCenter ? '1' : '.667',
                },
              }, h('button', {
                type: 'button',
                className: 'dsh-cn-node',
                'data-dsh-cn-node': key,
                'data-conversation-navigator-node': key,
                'data-node-index': index,
                'data-active': selected ? '' : undefined,
                'data-emphasis-center': emphasisCenter ? '' : undefined,
                'data-hovered': hoveredKey === key ? '' : undefined,
                'aria-label': label,
                'aria-describedby': hoveredKey === key ? previewId : undefined,
                'aria-current': selected ? 'step' : undefined,
                'aria-posinset': index + 1,
                'aria-setsize': messages.length,
                tabIndex: selected ? 0 : (selectedIndex < 0 && index === 0 ? 0 : -1),
              }, h('span', { className: 'dsh-cn-line', 'aria-hidden': true })))
            })),
            ),
            previewNode === null ? null : h('aside', {
              key: keyOf(previewNode) ?? `${previewNode.seq}:${previewIndex}`,
              id: previewId,
              className: 'dsh-cn-preview',
              style: {
                '--dsh-cn-preview-offset': `${nodeOffset(previewIndex, centerIndex)}px`,
                '--dsh-cn-preview-left': `${previewLeft}px`,
                '--dsh-cn-preview-width': `${previewWidth}px`,
              },
              role: 'tooltip',
              'data-preview-visible': '',
            }, h('strong', { className: 'dsh-cn-preview-head' }, previewTitle),
            h('p', { className: 'dsh-cn-preview-text' }, previewText)),
          ),
        )),
        document.body,
      )
    }

    const NS = 'conversation-navigator'
    const inject = ['slots', 'locale', 'sessions']
    const zh = { rail: '对话节点导航', user: '用户消息', noText: '无文本内容' }
    const en = { rail: 'Conversation nodes', user: 'User message', noText: 'No text content' }

    function apply(ctx) {
      // Settings → 内置插件: off switch means skip all injection. An explicit
      // renderer choice wins (same-origin reloads); only when it is absent does
      // the shell's dsh-disabled param apply (survives host restarts, where
      // localStorage is per-port).
      let off = false
      let decided = false
      try {
        const cached = window.localStorage.getItem('dsh.builtin.dsh-conversation-navigator.enabled')
        if (cached === '0') { off = true; decided = true }
        else if (cached === '1') decided = true
      } catch { /* storage unavailable */ }
      if (!decided) {
        try {
          const list = new URLSearchParams(window.location.search).get('dsh-disabled')
          if (list !== null && list.split(',').includes('dsh-conversation-navigator')) off = true
        } catch { /* non-desktop */ }
      }
      if (off) return
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'conversation-navigator: dictionaries')
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'conversation-navigator',
        order: 100,
        locale: NS,
        inject: () => ({ sessions: ctx.sessions }),
      }, Navigator))
    }

    return { apply, inject, Navigator }
  },
})
