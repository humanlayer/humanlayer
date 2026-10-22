import { describe, expect, it } from 'vitest'

import { matchActions } from '@/minimalist/lib/palette'

const ITEMS = [
	{ id: 'new', label: 'New task' },
	{ id: 'compact', label: 'Compact this session' },
	{ id: 'dark', label: 'Use dark appearance' },
	{ id: 'fork', label: 'Fork from your last message' },
]

const ids = (items: { id: string }[]) => items.map((item) => item.id)

describe('matchActions', () => {
	it('shows the idle set before you type, adding compact once the context is filling up', () => {
		expect(ids(matchActions(ITEMS, '', null))).toEqual(['new', 'fork'])
		expect(ids(matchActions(ITEMS, '  ', 30))).toEqual(['new', 'fork'])
		expect(ids(matchActions(ITEMS, '', 72))).toEqual(['new', 'compact', 'fork'])
	})

	it('matches any action by label once you type', () => {
		expect(ids(matchActions(ITEMS, 'DARK', null))).toEqual(['dark'])
		expect(ids(matchActions(ITEMS, 'task', null))).toEqual(['new'])
	})
})
