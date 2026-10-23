import { describe, expect, it } from 'vitest'

import { getVisibleSidebarTabs } from './sidebar-tabs'

describe('getVisibleSidebarTabs', () => {
	it('keeps Changes and Diffs in canonical cycle order', () => {
		expect(
			getVisibleSidebarTabs({
				todos: true,
				diffs: true,
				minimap: true,
				changes: true,
				artifacts: true,
				'scratch-pad': true,
			}),
		).toEqual(['artifacts', 'changes', 'diffs', 'scratch-pad', 'minimap', 'todos'])
	})

	it('puts GitHub first in the cycle whenever it is visible', () => {
		expect(
			getVisibleSidebarTabs({
				todos: true,
				diffs: true,
				minimap: true,
				changes: true,
				github: true,
			}),
		).toEqual(['github', 'changes', 'diffs', 'minimap', 'todos'])
	})

	it('derives task cycling order from the same visibility used by the rendered tabs', () => {
		expect(
			getVisibleSidebarTabs({
				'auto-advance': true,
				workspace: true,
				diffs: true,
				graph: true,
				changes: true,
				artifacts: true,
			}),
		).toEqual(['graph', 'artifacts', 'changes', 'diffs', 'workspace', 'auto-advance'])
	})
})
