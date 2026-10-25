import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setWindowAppearance } = vi.hoisted(() => ({ setWindowAppearance: vi.fn() }))
vi.mock('@/integrations/desktop/theme', () => ({ setWindowAppearance }))

import { useWindowAppearance } from './color-scheme'
import { UiProvider, useUi } from './ui-state'

function Probe() {
	useWindowAppearance()
	const { setTheme } = useUi()
	return (
		<>
			<button onClick={() => setTheme('light')}>Light</button>
			<button onClick={() => setTheme('system')}>System</button>
		</>
	)
}

describe('useWindowAppearance', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		localStorage.removeItem('hl-min-theme')
		vi.stubGlobal('matchMedia', () => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		}))
	})

	// The desktop shell decides what prefers-color-scheme reports, so System has to reach it as
	// 'system'; a resolved light or dark would pin the media query and System would stop following the OS.
	it('hands the theme preference itself to the desktop window', () => {
		render(
			<UiProvider>
				<Probe />
			</UiProvider>,
		)
		expect(setWindowAppearance).toHaveBeenLastCalledWith('system')

		fireEvent.click(screen.getByRole('button', { name: 'Light' }))
		expect(setWindowAppearance).toHaveBeenLastCalledWith('light')

		fireEvent.click(screen.getByRole('button', { name: 'System' }))
		expect(setWindowAppearance).toHaveBeenLastCalledWith('system')
	})
})
