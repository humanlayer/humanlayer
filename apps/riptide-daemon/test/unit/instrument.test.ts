import { afterEach, describe, expect, test, vi } from 'vitest'

const init = vi.hoisted(() => vi.fn())
vi.mock('@sentry/bun', async (importOriginal) => ({
	...(await importOriginal<typeof import('@sentry/bun')>()),
	init,
}))

afterEach(() => {
	init.mockClear()
	vi.unstubAllEnvs()
	vi.resetModules()
})

async function initOptions() {
	vi.stubEnv('SENTRY_ENVIRONMENT', 'prod')
	vi.resetModules()
	await import('../../src/instrument')
	return init.mock.calls[0]?.[0]
}

describe('daemon Sentry', () => {
	test('stays off without a build-time DSN', async () => {
		vi.stubEnv('RIPTIDE_DAEMON_SENTRY_DSN', '')
		expect(await initOptions()).toMatchObject({ dsn: undefined, enabled: false })
	})

	test('uses the build-time DSN', async () => {
		vi.stubEnv('RIPTIDE_DAEMON_SENTRY_DSN', 'https://key@sentry.example/1')
		expect(await initOptions()).toMatchObject({ dsn: 'https://key@sentry.example/1', enabled: true })
	})
})
