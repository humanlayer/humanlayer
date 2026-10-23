import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyAsyncTextToClipboard } from './clipboard'

afterEach(() => {
	delete (window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__
	vi.unstubAllGlobals()
})

describe('copyAsyncTextToClipboard', () => {
	it('uses writeText after resolving the value in Electron', async () => {
		;(window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__ = {}
		const writeText = vi.fn().mockResolvedValue(undefined)
		const write = vi.fn()
		vi.stubGlobal('navigator', { clipboard: { write, writeText } })
		vi.stubGlobal(
			'ClipboardItem',
			class {
				constructor() {
					throw new Error('ClipboardItem is unavailable in Electron')
				}
			},
		)

		await copyAsyncTextToClipboard(Promise.resolve('https://example.com/shared'))

		expect(writeText).toHaveBeenCalledWith('https://example.com/shared')
		expect(write).not.toHaveBeenCalled()
	})

	it('starts an async ClipboardItem write immediately in the browser', async () => {
		const write = vi.fn().mockResolvedValue(undefined)
		const writeText = vi.fn()
		const clipboardItem = vi.fn()
		vi.stubGlobal('navigator', { clipboard: { write, writeText } })
		vi.stubGlobal('ClipboardItem', clipboardItem)

		await copyAsyncTextToClipboard(Promise.resolve('https://example.com/shared'))

		expect(clipboardItem).toHaveBeenCalledOnce()
		expect(write).toHaveBeenCalledOnce()
		expect(writeText).not.toHaveBeenCalled()
	})
})
