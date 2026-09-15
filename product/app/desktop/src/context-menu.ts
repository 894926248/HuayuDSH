import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

/** Labels supplied by the desktop shell's current system locale. */
export interface ContextMenuLabels {
  copy: string
  cut: string
  paste: string
  selectAll: string
  delete: string
  saveImageAs: string
}

/** Native actions owned by the BrowserWindow that opened the menu. */
export interface ContextMenuActions {
  copy: () => void
  cut: () => void
  paste: () => void
  selectAll: () => void
  delete: () => void
  copyImage: () => void
  saveImageAs: () => void
}

/**
 * Build the deliberately small desktop context menu for one Chromium target.
 * Editable controls expose only the requested edit commands without Electron
 * roles, because roles automatically add shortcut labels to native menus.
 * Selected page text exposes copy only, and images expose copy plus save-as.
 * @param params - Chromium's context-menu target description.
 * @param labels - localized labels for the allowed commands.
 * @param actions - native image actions for the menu callbacks.
 * @returns the menu items to show; an empty list suppresses a menu for other targets.
 */
export function buildContextMenuTemplate(
  params: ContextMenuParams,
  labels: ContextMenuLabels,
  actions: ContextMenuActions,
): MenuItemConstructorOptions[] {
  if (params.isEditable) {
    const items: MenuItemConstructorOptions[] = [
      { label: labels.copy, enabled: params.editFlags.canCopy, click: actions.copy },
      { label: labels.cut, enabled: params.editFlags.canCut, click: actions.cut },
      { label: labels.paste, enabled: params.editFlags.canPaste, click: actions.paste },
      { label: labels.selectAll, enabled: params.editFlags.canSelectAll, click: actions.selectAll },
    ]
    if (params.editFlags.canDelete) items.push({ label: labels.delete, click: actions.delete })
    return items
  }

  if (params.mediaType === 'image') {
    return [
      { label: labels.copy, enabled: params.hasImageContents, click: actions.copyImage },
      { label: labels.saveImageAs, enabled: params.srcURL !== '', click: actions.saveImageAs },
    ]
  }

  return params.selectionText === ''
    ? []
    : [{ label: labels.copy, click: actions.copy }]
}
