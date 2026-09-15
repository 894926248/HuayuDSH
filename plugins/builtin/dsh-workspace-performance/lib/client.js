/**
 * Browser half: inject styles that let the renderer skip off-screen work via
 * the browser-native `content-visibility` mechanism:
 *  - sidebar session list rows (fixed 32px row contract), and
 *  - chat timeline nodes (`[data-chat-flow-key]`, giant sessions fold
 *    thousands of flow nodes; skipping their off-screen layout/paint is the
 *    dominant first-paint win).
 * This is the plugin-shaped replacement for the removed WorkspaceBrowser
 * virtualization overlay: no component replacement, no upstream file touched
 * — only stylesheet injection, so the official UI stays byte-for-byte
 * upstream while the renderer skips offscreen rows/nodes.
 *
 * If the upstream CSS-module class names change, the selectors degrade
 * gracefully (they simply stop matching; the plugin stays inert). The chat
 * selectors hook the semantic `data-chat-flow-*` attributes instead, which
 * are upstream's own stable anchors.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-performance',
  factory: () => {
    const STYLE_ID = 'dsh-workspace-performance-style'

    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
        /* Session list scroller: skip layout/paint for off-screen rows. */
        [class*="listArea"] [class*="projectRow"],
        [class*="listArea"] [class*="sessionItem"] {
          content-visibility: auto;
          contain-intrinsic-size: 32px;
          contain-intrinsic-block-size: 32px;
        }
        /* Group headers must keep normal flow (no intrinsic-size guessing). */
        [class*="listArea"] > [class*="groupHeader"] {
          content-visibility: visible;
        }
        /* Chat timeline: skip layout/paint for off-screen nodes. Giant
         * sessions fold thousands of flow nodes (one message carries its
         * whole tool chain); content-visibility keeps them in the DOM but
         * lets the browser skip their layout/paint until scrolled into
         * view. The auto keyword in contain-intrinsic-size remembers the
         * last rendered size per node, keeping the scrollbar honest. */
        [data-chat-flow] > [data-chat-flow-key] {
          content-visibility: auto;
          contain-intrinsic-size: auto 128px;
        }
        /* The composer-adjacent tail (in-flight message) must always lay
         * out normally so autoscroll and the input row never jump. */
        [data-chat-flow] > [data-chat-flow-key]:last-child {
          content-visibility: visible;
        }
      `
      document.head.append(style)
    }

    function apply() {
      // Settings → 内置插件: off switch means skip all injection. An explicit
      // renderer choice wins (same-origin reloads); only when it is absent does
      // the shell's dsh-disabled param apply (survives host restarts, where
      // localStorage is per-port).
      let off = false
      let decided = false
      try {
        const cached = window.localStorage.getItem('dsh.builtin.dsh-workspace-performance.enabled')
        if (cached === '0') { off = true; decided = true }
        else if (cached === '1') decided = true
      } catch { /* storage unavailable */ }
      if (!decided) {
        try {
          const list = new URLSearchParams(window.location.search).get('dsh-disabled')
          if (list !== null && list.split(',').includes('dsh-workspace-performance')) off = true
        } catch { /* non-desktop */ }
      }
      if (off) return
      ensureStyles()
    }

    return { name: 'dsh-workspace-performance', inject: [], apply }
  },
})
