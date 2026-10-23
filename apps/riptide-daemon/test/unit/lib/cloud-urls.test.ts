import { afterEach, describe, expect, test, vi } from 'vitest'

import { getTaskDeepLinkUrl } from '../../../src/lib/cloud-urls'

afterEach(() => {
	vi.unstubAllEnvs()
	vi.resetModules()
})

describe('getTaskDeepLinkUrl', () => {
	test('uses the app origin and enables native handoff', () => {
		expect(getTaskDeepLinkUrl('task-123')).toBe('https://app.vitest.test/tasks/task-123?deep=true')
	})

	test('has no link when no app origin is configured', async () => {
		vi.stubEnv('RIPTIDE_APP_ORIGIN', '')
		vi.stubEnv('RIPTIDE_DAEMON_APP_ORIGIN', '')
		vi.resetModules()
		const cloudUrls = await import('../../../src/lib/cloud-urls')

		expect(cloudUrls.getTaskDeepLinkUrl('task-123')).toBeUndefined()
	})
})
