/**
 * Browser half: "edit message" — an assistant-actions entry that pulls the
 * message text back into the composer. Pure plugin: registered through the
 * official `conversation.chat.assistant-actions` list slot; the click handler
 * walks the DOM (message row -> text -> composer textarea), no upstream file
 * and no internal API touched.
 */
window.__ModuleLoader__.load({
  id: 'dsh-message-edit',
  factory: require => {
    const React = require('react')
    const h = React.createElement
    const inject = ['slots']

    const STYLE_ID = 'dsh-message-edit-style'

    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
        .dsh-me-btn {
          border: 0;
          background: transparent;
          color: inherit;
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 4px;
          font-size: 12px;
          line-height: 16px;
          opacity: 0.85;
        }
        .dsh-me-btn:hover { background: rgb(255 255 255 / 10%); opacity: 1; }
      `
      document.head.append(style)
    }

    function findMessageText(buttonEl) {
      // The action row lives inside the message row; walk up to the closest
      // message-shaped container, then prefer the visible message text node.
      let row = buttonEl.closest('[data-time-hover-root]')
      if (!row) {
        // Fallback: any ancestor that looks like a message block.
        row = buttonEl.parentElement
        while (row && row !== document.body && row.children.length < 3) row = row.parentElement
      }
      if (!row || row === document.body) return ''
      const textEl = row.querySelector('[class*="messageText"], [data-message-text], [class*="messageText"] span')
      const raw = textEl ? textEl.textContent : row.innerText
      return raw ? raw.trim() : ''
    }

    function fillComposer(text) {
      if (!text) return
      const ta = document.querySelector('textarea')
      if (!ta) return
      ta.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      if (setter) setter.call(ta, text)
      else ta.value = text
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      ta.dispatchEvent(new Event('change', { bubbles: true }))
    }

    function EditButton({ messageId, t }) {
      const label = (t && typeof t === 'function' && t('message.edit')) || '编辑'
      const onClick = event => {
        event.stopPropagation()
        const text = findMessageText(event.currentTarget)
        if (text) fillComposer(text)
      }
      return h('button', { type: 'button', className: 'dsh-me-btn', 'aria-label': label, title: label, onClick }, '✎')
    }

    function apply(ctx) {
      // Settings → 内置插件: off switch means skip all injection. An explicit
      // renderer choice wins (same-origin reloads); only when it is absent does
      // the shell's dsh-disabled param apply (survives host restarts, where
      // localStorage is per-port).
      let off = false
      let decided = false
      try {
        const cached = window.localStorage.getItem('dsh.builtin.dsh-message-edit.enabled')
        if (cached === '0') { off = true; decided = true }
        else if (cached === '1') decided = true
      } catch { /* storage unavailable */ }
      if (!decided) {
        try {
          const list = new URLSearchParams(window.location.search).get('dsh-disabled')
          if (list !== null && list.split(',').includes('dsh-message-edit')) off = true
        } catch { /* non-desktop */ }
      }
      if (off) return
      ensureStyles()
      ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register(
        { name: 'conversation.chat.assistant-actions', id: 'dsh-message-edit', order: 10 },
        EditButton,
      ))
    }

    return { name: 'dsh-message-edit', inject, apply }
  },
})
