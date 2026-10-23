import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useSettingsStore } from '@/hooks/stores/settingsStore'

import { MinimalistUiSetting } from './MinimalistUiSetting'

beforeEach(() => {
	useSettingsStore.setState({ minimalistUiEnabled: false })
})

afterEach(() => {
	cleanup()
	useSettingsStore.setState({ minimalistUiEnabled: false })
})

describe('minimalist interface experiment', () => {
	it('is on for a new device', () => {
		expect(useSettingsStore.getInitialState().minimalistUiEnabled).toBe(true)
	})

	it('can be turned on and off from the same setting', () => {
		render(<MinimalistUiSetting />)
		const toggle = screen.getByRole('switch', { name: 'Minimalist interface' })
		expect(toggle.getAttribute('aria-checked')).toBe('false')
		fireEvent.click(toggle)
		expect(useSettingsStore.getState().minimalistUiEnabled).toBe(true)
		expect(toggle.getAttribute('aria-checked')).toBe('true')
		fireEvent.click(toggle)
		expect(useSettingsStore.getState().minimalistUiEnabled).toBe(false)
		expect(toggle.getAttribute('aria-checked')).toBe('false')
	})

	it('persists locally and retains the standard theme and agent defaults', async () => {
		const { theme, defaultAgent } = useSettingsStore.getState()
		render(<MinimalistUiSetting />)
		fireEvent.click(screen.getByRole('switch', { name: 'Minimalist interface' }))
		const storage = useSettingsStore.persist.getOptions().storage!
		const stored = await storage.getItem('riptide-settings')
		expect(stored?.state).toMatchObject({ minimalistUiEnabled: true, theme, defaultAgent })
		cleanup()
		await useSettingsStore.persist.rehydrate()
		render(<MinimalistUiSetting />)
		expect(screen.getByRole('switch', { name: 'Minimalist interface' }).getAttribute('aria-checked')).toBe('true')
		fireEvent.click(screen.getByRole('switch', { name: 'Minimalist interface' }))
		expect((await storage.getItem('riptide-settings'))?.state).toMatchObject({
			minimalistUiEnabled: false,
			theme,
			defaultAgent,
		})
	})
})
