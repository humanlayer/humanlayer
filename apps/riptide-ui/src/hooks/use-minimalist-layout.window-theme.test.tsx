import { ThemeProvider } from '@humanlayer/ui/components/theme-provider'
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ setWindowTheme: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
	useLocation: () => ({ pathname: '/', search: {} }),
	useNavigate: () => vi.fn(),
}))
vi.mock('@/integrations/desktop/theme', () => ({ setWindowTheme: mocks.setWindowTheme }))

import { useSettingsStore } from '@/hooks/stores/settingsStore'

import { useWindowThemeReporter } from './use-minimalist-layout'

function StandardTheme({ children }: { children: ReactNode }) {
	return (
		<ThemeProvider
			defaultTheme="rose-pine"
			storageKey="test-riptide-theme"
			onThemeChange={useWindowThemeReporter()}
		>
			{children}
		</ThemeProvider>
	)
}

function switchInterface(minimalist: boolean) {
	act(() => useSettingsStore.setState({ minimalistUiEnabled: minimalist }))
}

describe('useWindowThemeReporter', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.clearAllMocks()
		sessionStorage.clear()
	})
	afterEach(() => {
		vi.useRealTimers()
		localStorage.clear()
	})

	it('reports the standard theme to the window outside the minimalist interface', () => {
		switchInterface(false)
		render(<StandardTheme>{null}</StandardTheme>)
		vi.runAllTimers()
		expect(mocks.setWindowTheme).toHaveBeenCalledWith('rose-pine')
	})

	// The minimalist frame sets the window theme from its own preference. A standard report still
	// pending when the interface switches would land after it and pin System to the standard theme.
	it('leaves the window to the minimalist frame, including a report pending from before the switch', () => {
		switchInterface(false)
		render(<StandardTheme>{null}</StandardTheme>)
		switchInterface(true)
		vi.runAllTimers()
		expect(mocks.setWindowTheme).not.toHaveBeenCalled()

		switchInterface(false)
		vi.runAllTimers()
		expect(mocks.setWindowTheme).toHaveBeenCalledWith('rose-pine')
	})
})
