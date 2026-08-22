interface DesktopThemeColors {
  background: string
  foreground: string
  isDark: boolean
}

interface DesktopNotificationState {
  active: boolean
  count: number
}

interface DesktopBridge {
  readonly isDesktop: true
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
const PRODUCT_TITLE = 'DeepSeek Harness'
const DESKTOP_PANEL_INSET_ATTRIBUTE = 'data-dsh-desktop-panel-inset'
const DESKTOP_TOP_CONTROL_INSET_ATTRIBUTE = 'data-dsh-desktop-top-control-inset'
const DESKTOP_TOP_CONTROL_OFFSET_PROPERTY = '--dsh-desktop-top-control-offset'
const VIEWPORT_EDGE_EPSILON = 1
const MIN_PANEL_HEIGHT_RATIO = 0.8
const MAX_TOP_CONTROL_WIDTH = 160
const MAX_TOP_CONTROL_HEIGHT = TITLE_BAR_HEIGHT
const TOP_CONTROL_RIGHT_INSET = 16
const BETTER_SIDEBAR_TOGGLE_CLUSTER_CLASS_SUFFIX = '_toggleCluster'
const DESKTOP_NOTIFICATION_EVENT = 'dsh:desktop-notification'

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
  return normalized === '' || normalized === PRODUCT_TITLE
    ? PRODUCT_TITLE
    : `${PRODUCT_TITLE} - ${normalized}`
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

function syncDesktopFixedInsets(): void {
  for (const element of document.body.querySelectorAll('*')) {
    if (isDesktopPanelCandidate(element)) element.setAttribute(DESKTOP_PANEL_INSET_ATTRIBUTE, 'true')
    else element.removeAttribute(DESKTOP_PANEL_INSET_ATTRIBUTE)

    if (isBetterSidebarToggleCluster(element)) {
      if (!element.hasAttribute(DESKTOP_TOP_CONTROL_INSET_ATTRIBUTE)) {
        const top = getComputedStyle(element).top
        element.style.setProperty(DESKTOP_TOP_CONTROL_OFFSET_PROPERTY, /px$/u.test(top) ? top : '0px')
        element.setAttribute(DESKTOP_TOP_CONTROL_INSET_ATTRIBUTE, 'true')
      }
    } else if (element.hasAttribute(DESKTOP_TOP_CONTROL_INSET_ATTRIBUTE)) {
      element.removeAttribute(DESKTOP_TOP_CONTROL_INSET_ATTRIBUTE)
      if (element instanceof HTMLElement) element.style.removeProperty(DESKTOP_TOP_CONTROL_OFFSET_PROPERTY)
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

  const bar = document.createElement('div')
  bar.className = 'dsh-desktop-titlebar'

  const brand = document.createElement('div')
  brand.className = 'dsh-desktop-titlebar__brand'
  const logo = document.createElement('span')
  logo.className = 'dsh-desktop-titlebar__logo'
  logo.setAttribute('aria-hidden', 'true')
  const label = document.createElement('span')
  label.className = 'dsh-desktop-titlebar__label'
  label.textContent = PRODUCT_TITLE
  brand.append(logo, label)
  bar.append(brand)
  document.body.prepend(bar)

  const syncWindowTitle = (): void => {
    const title = desktopWindowTitle(document.title)
    bar.setAttribute('aria-label', title)
    bridge.setWindowTitle(title)
  }
  const titleObserver = new MutationObserver(syncWindowTitle)
  titleObserver.observe(document.head, { childList: true, subtree: true })
  syncWindowTitle()

  let frame: number | undefined
  const syncColors = (): void => {
    frame = undefined
    const computed = getComputedStyle(bar)
    const bodyComputed = getComputedStyle(document.body)
    const background = computed.backgroundColor === 'rgba(0, 0, 0, 0)'
      ? bodyComputed.backgroundColor
      : computed.backgroundColor
    const foreground = computed.color === ''
      ? bodyComputed.color
      : computed.color
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

  let panelFrame: number | undefined
  const schedulePanelSync = (): void => {
    if (panelFrame !== undefined) return
    panelFrame = window.requestAnimationFrame(() => {
      panelFrame = undefined
      syncDesktopFixedInsets()
    })
  }
  const panelObserver = new MutationObserver(schedulePanelSync)
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
