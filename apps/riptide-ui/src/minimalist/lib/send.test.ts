import { describe, expect, it } from 'vitest'

import { contextUsage } from '@/minimalist/lib/send'

const session = (patch: Partial<Parameters<typeof contextUsage>[0]>) => ({
	provider: 'anthropic',
	model: 'sonnet',
	context_window_tokens: null,
	context_window_limit: null,
	...patch,
})

describe('contextUsage', () => {
	it('is null before the agent reports tokens', () => {
		expect(contextUsage(session({}))).toBeNull()
	})

	it('uses the reported limit', () => {
		expect(contextUsage(session({ context_window_tokens: 50_000, context_window_limit: 100_000 }))).toMatchObject({
			tokens: 50_000,
			limit: 100_000,
		})
	})

	it("falls back to the model's window when the session reports no limit", () => {
		const usage = contextUsage(session({ context_window_tokens: 20_000 }))
		expect(usage).not.toBeNull()
		expect(usage?.limit).toBeGreaterThan(0)
		expect(usage?.percent).toBeGreaterThan(0)
	})
})
