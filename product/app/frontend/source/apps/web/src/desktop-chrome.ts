interface DesktopThemeColors {
  background: string
  foreground: string
  isDark: boolean
}

interface DesktopNotificationState {
  active: boolean
  count: number
}

interface DesktopVersionInfo {
  id: string
  productVersion: string
  upstreamVersion: string
  upstreamTag: string
  source: 'product' | 'official'
  switchable: boolean
  downloaded: boolean
  current: boolean
}

interface DesktopBridge {
  readonly isDesktop: true
  readonly currentUpstreamVersion: string
  openUpdate(): void
  listVersions(): Promise<DesktopVersionInfo[]>
  switchVersion(id: string): Promise<void>
  setNotificationState(state: DesktopNotificationState): void
  setTitleBarColors(colors: DesktopThemeColors): void
  setWindowTitle(title: string): void
  onActivate(listener: () => void): () => void
}

declare global {
  interface Window {
    dshDesktop?: DesktopBridge
  }
}

const TITLE_BAR_HEIGHT = 36
const PRODUCT_TITLE = 'DeepSeek'
const DESKTOP_PANEL_INSET_ATTRIBUTE = 'data-dsh-desktop-panel-inset'
const DESKTOP_TOP_CONTROL_INSET_ATTRIBUTE = 'data-dsh-desktop-top-control-inset'
const DESKTOP_TOP_CONTROL_OFFSET_PROPERTY = '--dsh-desktop-top-control-offset'
const VIEWPORT_EDGE_EPSILON = 1
const MIN_PANEL_HEIGHT_RATIO = 0.8
const MAX_TOP_CONTROL_WIDTH = 160
const MAX_TOP_CONTROL_HEIGHT = TITLE_BAR_HEIGHT
const TOP_CONTROL_RIGHT_INSET = 16
let activeDesktopVersion = ''
let desktopVersionFetchStarted = false
let activeVersionSelector: HTMLElement | undefined
const BETTER_SIDEBAR_TOGGLE_CLUSTER_CLASS_SUFFIX = '_toggleCluster'
const DESKTOP_NOTIFICATION_EVENT = 'dsh:desktop-notification'

function versionDisplay(version: DesktopVersionInfo): string {
  return version.upstreamVersion !== '' ? version.upstreamVersion : version.productVersion
}

function createVersionSelector(bridge: DesktopBridge): HTMLElement {
  const chinese = navigator.language.toLowerCase().startsWith('zh')
  const labels = chinese
    ? { choose: '选择版本', current: '当前', downloaded: '已下载', available: '可切换', official: '官方版本', unbuilt: '未构建产品包', loading: '正在读取版本', switching: '正在切换', failed: '版本切换失败', empty: '暂无可用版本' }
    : { choose: 'Select version', current: 'Current', downloaded: 'Downloaded', available: 'Ready', official: 'Official', unbuilt: 'Product build missing', loading: 'Loading versions', switching: 'Switching', failed: 'Version switch failed', empty: 'No versions available' }

  const wrapper = document.createElement('div')
  wrapper.className = 'dsh-desktop-titlebar__version'
  const trigger = document.createElement('button')
  trigger.className = 'dsh-desktop-titlebar__version-trigger'
  trigger.type = 'button'
  trigger.setAttribute('aria-haspopup', 'listbox')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-label', labels.choose)
  const triggerLabel = document.createElement('span')
  triggerLabel.className = 'dsh-desktop-titlebar__version-label'
  triggerLabel.textContent = bridge.currentUpstreamVersion === '' ? labels.choose : `v${bridge.currentUpstreamVersion}`
  trigger.append(triggerLabel)

  const menu = document.createElement('div')
  menu.className = 'dsh-desktop-titlebar__version-menu'
  menu.setAttribute('role', 'listbox')
  menu.setAttribute('aria-label', labels.choose)
  menu.hidden = true

  let versions: DesktopVersionInfo[] = []
  let open = false
  let busy = false

  const setOpen = (next: boolean): void => {
    open = next
    menu.hidden = !next
    trigger.setAttribute('aria-expanded', String(next))
    wrapper.dataset.open = String(next)
  }

  const render = (): void => {
    menu.replaceChildren()
    if (versions.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'dsh-desktop-titlebar__version-empty'
      empty.textContent = busy ? labels.loading : labels.empty
      menu.append(empty)
      return
    }
    for (const version of versions) {
      const item = document.createElement('button')
      item.className = 'dsh-desktop-titlebar__version-item'
      item.type = 'button'
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', String(version.current))
      item.disabled = busy || version.current || !version.switchable
      const copy = document.createElement('span')
      copy.className = 'dsh-desktop-titlebar__version-copy'
      const primary = document.createElement('span')
      primary.className = 'dsh-desktop-titlebar__version-primary'
      primary.textContent = `v${versionDisplay(version)}`
      const secondary = document.createElement('span')
      secondary.className = 'dsh-desktop-titlebar__version-secondary'
      secondary.textContent = version.upstreamTag === '' ? '' : `${labels.official} · ${version.upstreamTag}`
      copy.append(primary, secondary)
      const status = document.createElement('span')
      status.className = 'dsh-desktop-titlebar__version-status'
      status.dataset.downloaded = String(version.downloaded)
      status.textContent = version.current
        ? labels.current
        : !version.switchable
          ? labels.unbuilt
          : version.downloaded
            ? labels.downloaded
            : labels.available
      item.append(copy, status)
      item.addEventListener('click', () => {
        if (busy || version.current) return
        busy = true
        triggerLabel.textContent = labels.switching
        trigger.disabled = true
        render()
        void bridge.switchVersion(version.id).catch((error: unknown) => {
          busy = false
          trigger.disabled = false
          triggerLabel.textContent = labels.failed
          const detail = error instanceof Error ? error.message : String(error)
          trigger.title = detail
          render()
        })
      })
      menu.append(item)
    }
  }

  const refresh = async (): Promise<void> => {
    busy = true
    trigger.disabled = false
    render()
    try {
      versions = await bridge.listVersions()
      const current = versions.find(version => version.current)
      triggerLabel.textContent = current === undefined ? labels.choose : `v${versionDisplay(current)}`
      trigger.title = labels.choose
    } catch (error) {
      versions = []
      triggerLabel.textContent = bridge.currentUpstreamVersion === '' ? labels.failed : `v${bridge.currentUpstreamVersion}`
      trigger.title = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
      trigger.disabled = false
      render()
    }
  }

  trigger.addEventListener('click', () => {
    setOpen(!open)
    if (open && versions.length === 0 && !busy) void refresh()
  })
  wrapper.addEventListener('dsh:toggle-version-menu', () => {
    setOpen(!open)
    if (open && versions.length === 0 && !busy) void refresh()
  })
  document.addEventListener('pointerdown', event => {
    if (open && !wrapper.contains(event.target as Node)) setOpen(false)
  })
  document.addEventListener('keydown', event => {
    if (open && event.key === 'Escape') {
      setOpen(false)
      trigger.focus()
    }
  })

  wrapper.append(trigger, menu)
  void refresh()
  return wrapper
}

function isDesktopNotificationState(value: unknown): value is DesktopNotificationState {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Partial<DesktopNotificationState>
  return typeof state.active === 'boolean'
    && typeof state.count === 'number'
    && Number.isSafeInteger(state.count)
    && state.count >= 0
}

function desktopWindowTitle(documentTitle: string): string {
  const normalized = documentTitle.trim()
  return normalized === '' || normalized === PRODUCT_TITLE || normalized === 'DSH Local Build'
    ? PRODUCT_TITLE
    : `${PRODUCT_TITLE} - ${normalized}`
}

function normalizeFallbackBrand(): void {
  const version = activeDesktopVersion || window.dshDesktop?.currentUpstreamVersion.trim() || ''
  for (const element of document.querySelectorAll('span')) {
    if (element.textContent?.trim() === 'DSH Local Build') element.textContent = PRODUCT_TITLE
    if (version !== undefined && version !== '' && /^[0-9a-f]{7}$/iu.test(element.textContent?.trim() ?? '')) {
      element.textContent = `v${version}`
    }
  }
}

function installVersionControl(bridge: DesktopBridge): void {
  if (activeDesktopVersion === '') activeDesktopVersion = bridge.currentUpstreamVersion.trim()
  if (!desktopVersionFetchStarted) {
    desktopVersionFetchStarted = true
    void bridge.listVersions().then(versions => {
      const current = versions.find(version => version.current)
      if (current !== undefined) {
        activeDesktopVersion = versionDisplay(current)
        normalizeFallbackBrand()
      }
    }).catch(() => undefined)
  }
  const badge = Array.from(document.querySelectorAll('span')).find(element => {
    if (element.closest('.dsh-desktop-version-control, .dsh-desktop-titlebar__version-menu') !== null) return false
    const text = element.textContent?.trim() ?? ''
    if (!/^[0-9a-f]{7}$/iu.test(text) && !/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/iu.test(text)) return false
    return element.getBoundingClientRect().top < TITLE_BAR_HEIGHT
  })
  if (!(badge instanceof HTMLElement)) return
  if (badge.dataset.dshVersionControl === 'true') return
  badge.dataset.dshVersionControl = 'true'
  const versionButton = badge
  versionButton.classList.add('dsh-desktop-version-badge')
  const brandButton = versionButton.closest('button')
  if (brandButton !== null) (brandButton.style as CSSStyleDeclaration & { webkitAppRegion?: string }).webkitAppRegion = 'no-drag'
  versionButton.setAttribute('role', 'button')
  versionButton.tabIndex = 0
  versionButton.textContent = activeDesktopVersion === '' ? badge.textContent?.trim() ?? '' : `v${activeDesktopVersion}`
  versionButton.title = navigator.language.toLowerCase().startsWith('zh') ? '切换版本' : 'Switch version'
  versionButton.setAttribute('aria-label', versionButton.title)
  activeVersionSelector?.remove()
  const selector = createVersionSelector(bridge)
  selector.classList.add('dsh-desktop-version-control')
  document.body.append(selector)
  activeVersionSelector = selector
  const place = (): void => {
    const currentBadge = document.querySelector<HTMLElement>('.dsh-desktop-version-badge') ?? versionButton
    const rect = currentBadge.getBoundingClientRect()
    selector.style.left = `${String(Math.round(rect.left))}px`
    selector.style.top = `${String(Math.round(rect.bottom + 6))}px`
  }
  versionButton.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    const rect = versionButton.getBoundingClientRect()
    selector.style.left = `${String(Math.round(rect.left))}px`
    selector.style.top = `${String(Math.round(rect.bottom + 6))}px`
    selector.dispatchEvent(new Event('dsh:toggle-version-menu'))
  })
  versionButton.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    versionButton.click()
  })
  window.addEventListener('resize', place)
  place()
  requestAnimationFrame(place)
}

function isDesktopPanelCandidate(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || element.id === 'root') return false

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  if (viewportWidth <= 0 || viewportHeight <= 0) return false

  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.position === 'fixed'
    && rect.top <= TITLE_BAR_HEIGHT + VIEWPORT_EDGE_EPSILON
    && rect.right >= viewportWidth - VIEWPORT_EDGE_EPSILON
    && rect.width > 0
    && rect.width < viewportWidth
    && rect.height >= viewportHeight * MIN_PANEL_HEIGHT_RATIO
}

function isBetterSidebarToggleCluster(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || element.id === 'root') return false

  const viewportWidth = window.innerWidth
  if (viewportWidth <= 0) return false

  // The external sidebar's CSS-module class preserves this source key as a
  // suffix. Restrict the desktop adapter to that owned cluster so unrelated
  // browser and plugin toolbars stay exactly where their owners place them.
  if (!Array.from(element.classList).some(className => className.endsWith(BETTER_SIDEBAR_TOGGLE_CLUSTER_CLASS_SUFFIX))) {
    return false
  }

  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  const wasInset = element.hasAttribute(DESKTOP_TOP_CONTROL_INSET_ATTRIBUTE)
  return style.position === 'fixed'
    && rect.top >= -VIEWPORT_EDGE_EPSILON
    && rect.top <= (wasInset ? TITLE_BAR_HEIGHT * 2 : TITLE_BAR_HEIGHT + VIEWPORT_EDGE_EPSILON)
    && rect.right >= viewportWidth - TOP_CONTROL_RIGHT_INSET
    && rect.width > 0
    && rect.width <= MAX_TOP_CONTROL_WIDTH
    && rect.height > 0
    && rect.height <= MAX_TOP_CONTROL_HEIGHT
    && element.querySelector('button') !== null
}

const TRACKED_PANEL_INSET = new Set<HTMLElement>()
const TRACKED_TOP_CONTROL_INSET = new Set<HTMLElement>()
let panelSyncTimer: number | undefined

/** Coalesce MutationObserver bursts into one trailing call per window. The
 * desktop chrome only reacts to layout-affecting changes (panel/inset/brand),
 * so sub-second staleness is invisible while full-DOM scans on every frame
 * were the original freeze: observers on the whole body fired on every React
 * mutation and each handler walked and measured the entire document. */
function throttled(handler: () => void, windowMs: number): () => void {
  let timer: number | undefined
  return () => {
    if (timer !== undefined) return
    timer = window.setTimeout(() => {
      timer = undefined
      handler()
    }, windowMs)
  }
}

/** Sample a handful of viewport points and climb their ancestor chains to find
 * the fixed-position elements the desktop adapter must inset (a top panel and
 * the sidebar toggle cluster). This replaces a full-DOM scan that measured
 * every element with getComputedStyle + getBoundingClientRect on every frame. */
function findFixedCandidates(): HTMLElement[] {
  const found: HTMLElement[] = []
  const points: Array<[number, number]> = [
    [Math.round(window.innerWidth * 0.5), Math.round(TITLE_BAR_HEIGHT * 0.5)],
    [Math.round(window.innerWidth * 0.95), Math.round(TITLE_BAR_HEIGHT * 0.5)],
    [Math.round(window.innerWidth * 0.9), TITLE_BAR_HEIGHT],
  ]
  for (const [x, y] of points) {
    const hits = document.elementsFromPoint(x, y)
    let current: Element | null = null
    for (const hit of hits) {
      if (!(hit instanceof HTMLElement)) continue
      current = hit
      break
    }
    while (current !== null && current !== document.body) {
      if (current instanceof HTMLElement && current.id !== 'root' && getComputedStyle(current).position === 'fixed') {
        if (!found.includes(current)) found.push(current)
        break
      }
      current = current.parentElement
    }
  }
  return found
}

function syncDesktopFixedInsets(): void {
  const candidates = new Set(findFixedCandidates())

  for (const element of TRACKED_PANEL_INSET) {
    if (!candidates.has(element) || !isDesktopPanelCandidate(element)) {
      element.removeAttribute(DESKTOP_PANEL_INSET_ATTRIBUTE)
      TRACKED_PANEL_INSET.delete(element)
    }
  }
  for (const element of TRACKED_TOP_CONTROL_INSET) {
    if (!candidates.has(element) || !isBetterSidebarToggleCluster(element)) {
      element.removeAttribute(DESKTOP_TOP_CONTROL_INSET_ATTRIBUTE)
      if (element instanceof HTMLElement) element.style.removeProperty(DESKTOP_TOP_CONTROL_OFFSET_PROPERTY)
      TRACKED_TOP_CONTROL_INSET.delete(element)
    }
  }

  for (const element of candidates) {
    if (isDesktopPanelCandidate(element)) {
      element.setAttribute(DESKTOP_PANEL_INSET_ATTRIBUTE, 'true')
      TRACKED_PANEL_INSET.add(element)
    }
    if (isBetterSidebarToggleCluster(element)) {
      if (!element.hasAttribute(DESKTOP_TOP_CONTROL_INSET_ATTRIBUTE)) {
        const top = getComputedStyle(element).top
        element.style.setProperty(DESKTOP_TOP_CONTROL_OFFSET_PROPERTY, /px$/u.test(top) ? top : '0px')
        element.setAttribute(DESKTOP_TOP_CONTROL_INSET_ATTRIBUTE, 'true')
      }
      TRACKED_TOP_CONTROL_INSET.add(element)
    }
  }
}

/** Install the small native-window identity row when the renderer runs in Electron. */
export function installDesktopChrome(): void {
  const bridge = window.dshDesktop
  if (bridge?.isDesktop !== true) return

  bridge.setNotificationState({ active: false, count: 0 })
  document.addEventListener(DESKTOP_NOTIFICATION_EVENT, (event) => {
    const detail = (event as CustomEvent<unknown>).detail
    if (isDesktopNotificationState(detail)) bridge.setNotificationState(detail)
  })

  document.documentElement.dataset.dshDesktop = 'true'
  document.body.dataset.dshDesktop = 'true'
  const dragRegion = document.createElement('div')
  dragRegion.className = 'dsh-desktop-drag-region'
  dragRegion.setAttribute('aria-hidden', 'true')
  document.body.append(dragRegion)

  const syncWindowTitle = (): void => {
    const title = desktopWindowTitle(document.title)
    bridge.setWindowTitle(title)
  }
  const titleObserver = new MutationObserver(syncWindowTitle)
  titleObserver.observe(document.head, { childList: true, subtree: true })
  syncWindowTitle()

  const brandObserver = new MutationObserver(throttled(() => normalizeFallbackBrand(), 500))
  brandObserver.observe(document.body, { characterData: true, childList: true, subtree: true })
  normalizeFallbackBrand()
  const versionObserver = new MutationObserver(throttled(() => installVersionControl(bridge), 500))
  versionObserver.observe(document.body, { characterData: true, childList: true, subtree: true })
  installVersionControl(bridge)

  let frame: number | undefined
  const syncColors = (): void => {
    frame = undefined
    const bodyComputed = getComputedStyle(document.body)
    const background = bodyComputed.backgroundColor
    const foreground = bodyComputed.color
    bridge.setTitleBarColors({
      background,
      foreground,
      isDark: document.body.hasAttribute('data-ds-dark-theme'),
    })
  }
  const scheduleColorSync = (): void => {
    if (frame !== undefined) return
    frame = window.requestAnimationFrame(syncColors)
  }
  const observer = new MutationObserver(scheduleColorSync)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] })

  const schedulePanelSync = (): void => {
    if (panelSyncTimer !== undefined) return
    panelSyncTimer = window.setTimeout(() => {
      panelSyncTimer = undefined
      syncDesktopFixedInsets()
    }, 300)
  }
  const panelObserver = new MutationObserver(throttled(schedulePanelSync, 300))
  panelObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'style'],
    childList: true,
    subtree: true,
  })
  window.addEventListener('resize', schedulePanelSync)
  syncDesktopFixedInsets()

  bridge.onActivate(() => {
    window.focus()
    document.dispatchEvent(new Event('dsh:activate'))
  })
  scheduleColorSync()

  document.documentElement.style.setProperty('--dsh-desktop-titlebar-height', `${String(TITLE_BAR_HEIGHT)}px`)
}
