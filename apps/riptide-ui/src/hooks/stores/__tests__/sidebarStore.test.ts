import { describe, expect, test } from 'vitest'

import { useSidebarStore } from '../sidebarStore'

describe('sidebar store', () => {
	test('defaults to an expanded sidebar', () => {
		expect(useSidebarStore.getState().sidebarCollapsed).toBe(false)
	})
})
