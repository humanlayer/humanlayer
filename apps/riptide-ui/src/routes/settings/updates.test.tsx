import { cleanup, render } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './updates'

const { search, navigate, checkNow } = vi.hoisted(() => ({
	search: { current: {} as { updateCheck?: true } },
	navigate: vi.fn(),
	checkNow: vi.fn(async () => {}),
}))
vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (options: object) => ({
		...options,
		useSearch: () => search.current,
		useNavigate: () => navigate,
	}),
}))
vi.mock('@/hooks/use-update', () => ({ useUpdate: () => ({ checkNow }) }))
vi.mock('@/components/settings/UpdatesSettingsSection', () => ({ UpdatesSettingsSection: () => null }))

const route = Route as unknown as {
	validateSearch: (search: Record<string, unknown>) => { updateCheck?: true }
	component: ComponentType
}

beforeEach(() => {
	vi.clearAllMocks()
	search.current = {}
})
afterEach(cleanup)

describe('/settings/updates', () => {
	it('reads updateCheck=true from the URL and ignores anything else', () => {
		expect(route.validateSearch({ updateCheck: 'true' })).toEqual({ updateCheck: true })
		expect(route.validateSearch({ updateCheck: true })).toEqual({ updateCheck: true })
		expect(route.validateSearch({ updateCheck: 'no' })).toEqual({})
		expect(route.validateSearch({})).toEqual({})
	})

	it('checks for updates once and clears the param, keeping the rest of the query', () => {
		search.current = { updateCheck: true }
		const Page = route.component
		render(<Page />)
		expect(checkNow).toHaveBeenCalledTimes(1)
		expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ replace: true }))
		const { search: next } = navigate.mock.calls[0]?.[0] as {
			search: (previous: Record<string, unknown>) => Record<string, unknown>
		}
		expect(next({ updateCheck: true, minui: 'true' })).toEqual({ minui: 'true' })
	})

	it('does nothing without the param', () => {
		const Page = route.component
		render(<Page />)
		expect(checkNow).not.toHaveBeenCalled()
		expect(navigate).not.toHaveBeenCalled()
	})
})
