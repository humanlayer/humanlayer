import { describe, expect, test } from 'vitest'

import {
	DEFAULT_ARTIFACT_RIGHT_SIDEBAR_SIZE_PERCENT,
	DEFAULT_NORMAL_RIGHT_SIDEBAR_SIZE_PERCENT,
	getRightSidebarSizeForMode,
	isValidCurrentRightSidebarSizePercent,
	isValidRightSidebarSizePercent,
	useRightSidebarSizeStore,
} from '../rightSidebarSizeStore'

describe('rightSidebarSizeStore', () => {
	test('uses product defaults for normal and artifact modes', () => {
		useRightSidebarSizeStore.setState({
			currentSizePercent: DEFAULT_NORMAL_RIGHT_SIDEBAR_SIZE_PERCENT,
			normalSizePercent: DEFAULT_NORMAL_RIGHT_SIDEBAR_SIZE_PERCENT,
			artifactSizePercent: DEFAULT_ARTIFACT_RIGHT_SIDEBAR_SIZE_PERCENT,
		})

		expect(useRightSidebarSizeStore.getState().getSizeForMode('normal')).toBe(20)
		expect(useRightSidebarSizeStore.getState().getSizeForMode('artifact')).toBe(50)
	})

	test('updates the current size and only the selected mode size', () => {
		useRightSidebarSizeStore.setState({ currentSizePercent: 20, normalSizePercent: 20, artifactSizePercent: 50 })

		useRightSidebarSizeStore.getState().setCurrentSizeForMode('normal', 34)
		expect(useRightSidebarSizeStore.getState().currentSizePercent).toBe(34)
		expect(useRightSidebarSizeStore.getState().normalSizePercent).toBe(34)
		expect(useRightSidebarSizeStore.getState().artifactSizePercent).toBe(50)

		useRightSidebarSizeStore.getState().setCurrentSizeForMode('artifact', 55)
		expect(useRightSidebarSizeStore.getState().currentSizePercent).toBe(55)
		expect(useRightSidebarSizeStore.getState().normalSizePercent).toBe(34)
		expect(useRightSidebarSizeStore.getState().artifactSizePercent).toBe(55)
	})

	test('represents collapsed as a zero current size without losing mode widths', () => {
		useRightSidebarSizeStore.setState({ currentSizePercent: 50, normalSizePercent: 24, artifactSizePercent: 50 })

		useRightSidebarSizeStore.getState().setCurrentSizeForMode('artifact', 0)

		expect(useRightSidebarSizeStore.getState().currentSizePercent).toBe(0)
		expect(useRightSidebarSizeStore.getState().normalSizePercent).toBe(24)
		expect(useRightSidebarSizeStore.getState().artifactSizePercent).toBe(50)
	})

	test('ignores invalid persisted resize values', () => {
		useRightSidebarSizeStore.setState({ currentSizePercent: 20, normalSizePercent: 20, artifactSizePercent: 50 })

		useRightSidebarSizeStore.getState().setCurrentSizeForMode('artifact', Number.NaN)

		expect(useRightSidebarSizeStore.getState().currentSizePercent).toBe(20)
		expect(useRightSidebarSizeStore.getState().normalSizePercent).toBe(20)
		expect(useRightSidebarSizeStore.getState().artifactSizePercent).toBe(50)
	})

	test('selects the size for the requested mode', () => {
		const state = { normalSizePercent: 28, artifactSizePercent: 52 }

		expect(getRightSidebarSizeForMode(state, 'normal')).toBe(28)
		expect(getRightSidebarSizeForMode(state, 'artifact')).toBe(52)
		expect(isValidRightSidebarSizePercent(28)).toBe(true)
		expect(isValidRightSidebarSizePercent(0)).toBe(false)
		expect(isValidCurrentRightSidebarSizePercent(0)).toBe(true)
		expect(isValidCurrentRightSidebarSizePercent(-1)).toBe(false)
	})
})
