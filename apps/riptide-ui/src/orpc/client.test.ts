import { ORPCError } from '@orpc/client'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'

import { handleRiptideApiError } from './client'

vi.mock('sonner', () => ({
	toast: { warning: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

describe('handleRiptideApiError UNAUTHORIZED', () => {
	it('shows nothing and stays on the page', () => {
		const navigate = vi.fn()

		handleRiptideApiError(new ORPCError('UNAUTHORIZED'), undefined, { navigate, isOnOrgPages: false, roles: null })

		expect(toast.warning).not.toHaveBeenCalled()
		expect(toast.error).not.toHaveBeenCalled()
		expect(navigate).not.toHaveBeenCalled()
	})
})
