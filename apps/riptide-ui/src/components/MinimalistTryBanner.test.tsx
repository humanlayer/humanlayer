import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { BetaBanner } from '@/minimalist/components/BetaBanner'

import { MinimalistTryBanner } from './MinimalistTryBanner'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/react-router')>()),
	useNavigate: () => vi.fn(),
	useLocation: () => ({ pathname: '/', search: {} }),
}))

const reset = () =>
	useSettingsStore.setState({ minimalistUiEnabled: true, minimalistBannersDismissed: { beta: false, tryIt: false } })

beforeEach(reset)
afterEach(() => {
	cleanup()
	reset()
})

describe('minimalist UI banners', () => {
	it('switches back to the standard UI from the beta banner', () => {
		render(<BetaBanner />)
		fireEvent.click(screen.getByRole('button', { name: 'Switch back to the old UI' }))
		expect(useSettingsStore.getState().minimalistUiEnabled).toBe(false)
	})

	it('turns the minimalist UI on from the standard banner', () => {
		useSettingsStore.setState({ minimalistUiEnabled: false })
		render(<MinimalistTryBanner />)
		fireEvent.click(screen.getByRole('button', { name: 'Try it now' }))
		expect(useSettingsStore.getState().minimalistUiEnabled).toBe(true)
	})

	it('dismisses each banner on its own', () => {
		render(
			<>
				<BetaBanner />
				<MinimalistTryBanner />
			</>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'Dismiss beta banner' }))
		expect(screen.queryByText(/This is the beta/)).toBeNull()
		expect(screen.getByText('Try the new minimalist UI beta.')).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Dismiss minimalist UI banner' }))
		expect(screen.queryByText('Try the new minimalist UI beta.')).toBeNull()
		expect(useSettingsStore.getState().minimalistBannersDismissed).toEqual({ beta: true, tryIt: true })
	})
})
