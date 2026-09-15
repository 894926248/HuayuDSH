import { describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams } from 'electron'
import { buildContextMenuTemplate } from '../src/context-menu.ts'

const labels = {
  copy: '复制',
  cut: '剪切',
  paste: '粘贴',
  selectAll: '全选',
  delete: '删除',
  saveImageAs: '图片另存为',
} as const

function params(overrides: Partial<ContextMenuParams> = {}): ContextMenuParams {
  return {
    isEditable: false,
    editFlags: {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canDelete: false,
      canSelectAll: false,
      canEditRichly: false,
    },
    mediaType: 'none',
    hasImageContents: false,
    selectionText: '',
    srcURL: '',
    ...overrides,
  } as ContextMenuParams
}

function actions() {
  return {
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn(),
    delete: vi.fn(),
    copyImage: vi.fn(),
    saveImageAs: vi.fn(),
  }
}

describe('buildContextMenuTemplate', () => {
  it('keeps the edit menu limited to commands without shortcut labels', () => {
    const editActions = actions()
    const result = buildContextMenuTemplate(params({
      isEditable: true,
      editFlags: {
        canUndo: false, canRedo: false, canCut: true, canCopy: true, canPaste: true,
        canDelete: true, canSelectAll: true, canEditRichly: false,
      },
    }), labels, editActions)

    expect(result.map(item => item.label)).toEqual(['复制', '剪切', '粘贴', '全选', '删除'])
    expect(result.every(item => item.role === undefined && item.accelerator === undefined)).toBe(true)
    result.forEach(item => item.click?.(undefined as never, undefined, undefined as never))
    expect(editActions.copy).toHaveBeenCalledOnce()
    expect(editActions.cut).toHaveBeenCalledOnce()
    expect(editActions.paste).toHaveBeenCalledOnce()
    expect(editActions.selectAll).toHaveBeenCalledOnce()
    expect(editActions.delete).toHaveBeenCalledOnce()
  })

  it('keeps unavailable edit operations visible but disabled', () => {
    const result = buildContextMenuTemplate(params({ isEditable: true }), labels, actions())

    expect(result.map(item => item.label)).toEqual(['复制', '剪切', '粘贴', '全选'])
    expect(result.every(item => item.enabled === false)).toBe(true)
    expect(result.every(item => item.role === undefined && item.accelerator === undefined)).toBe(true)
  })

  it('offers only copy for selected non-editable text', () => {
    const textActions = actions()
    const result = buildContextMenuTemplate(params({ selectionText: 'selected text' }), labels, textActions)

    expect(result).toHaveLength(1)
    expect(result[0]?.label).toBe('复制')
    expect(result[0]?.role).toBeUndefined()
    expect(result[0]?.accelerator).toBeUndefined()
    result[0]?.click?.(undefined as never, undefined, undefined as never)
    expect(textActions.copy).toHaveBeenCalledOnce()
  })

  it('offers copy and save-as for a real image', () => {
    const imageActions = actions()
    const result = buildContextMenuTemplate(params({
      mediaType: 'image', hasImageContents: true, srcURL: 'https://example.test/image.png',
    }), labels, imageActions)

    expect(result.map(item => item.label)).toEqual(['复制', '图片另存为'])
    expect(result.every(item => item.enabled !== false)).toBe(true)
    result[0]?.click?.(undefined as never, undefined, undefined as never)
    result[1]?.click?.(undefined as never, undefined, undefined as never)
    expect(imageActions.copyImage).toHaveBeenCalledOnce()
    expect(imageActions.saveImageAs).toHaveBeenCalledOnce()
  })

  it('does not show image actions for an empty image target', () => {
    const result = buildContextMenuTemplate(params({ mediaType: 'image' }), labels, actions())

    expect(result).toHaveLength(2)
    expect(result[0]?.enabled).toBe(false)
    expect(result[1]?.enabled).toBe(false)
  })
})
