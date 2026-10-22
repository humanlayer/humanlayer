import { afterEach, describe, expect, it } from 'vitest'

import { clampWidth, saveWidth, storedWidth, storedWidthStyle } from '@/minimalist/lib/panel-widths'

afterEach(() => localStorage.clear())

describe('panel widths', () => {
	it('keeps widths inside each pane’s limits', () => {
		expect(clampWidth('sidebar', 50)).toBe(200)
		expect(clampWidth('sidebar', 9999)).toBe(480)
		expect(clampWidth('task-right', 412.6)).toBe(413)
	})

	it('saves, restores and forgets a width', () => {
		expect(storedWidth('task-nav')).toBeNull()
		saveWidth('task-nav', 300)
		expect(storedWidth('task-nav')).toBe(300)
		expect(storedWidthStyle()).toEqual({ '--task-nav-w': '300px' })
		saveWidth('task-nav', null)
		expect(storedWidthStyle()).toEqual({})
	})

	it('ignores junk and clamps a saved width that is out of range', () => {
		localStorage.setItem('hl-min-width-sidebar', 'wide')
		localStorage.setItem('hl-min-width-panel', '5000')
		expect(storedWidthStyle()).toEqual({ '--panel-w': '1000px' })
	})
})
