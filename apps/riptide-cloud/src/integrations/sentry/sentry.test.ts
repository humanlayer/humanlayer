import type { AnyRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const init = vi.hoisted(() => vi.fn())
vi.mock('@sentry/react', async (importOriginal) => ({
	...(await importOriginal<typeof import('@sentry/react')>()),
	init,
}))

import { initializeSentry } from './sentry'

const router = {} as AnyRouter

describe('initializeSentry', () => {
	beforeEach(() => {
		init.mockClear()
		vi.stubEnv('DEV', false)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	test('never calls Sentry.init without a DSN', () => {
		vi.stubEnv('VITE_PUBLIC_SENTRY_DSN', '')
		initializeSentry(router)
		expect(init).not.toHaveBeenCalled()
	})

	test('passes the DSN from the build env', () => {
		vi.stubEnv('VITE_PUBLIC_SENTRY_DSN', 'https://key@sentry.example/1')
		initializeSentry(router)
		expect(init).toHaveBeenCalledWith(expect.objectContaining({ dsn: 'https://key@sentry.example/1' }))
	})
})
