import { afterEach } from 'vitest'

afterEach(async () => {
	const { waitForPendingSessionTitleGenerations } = await import('../../src/lib/session-title-generation')
	await waitForPendingSessionTitleGenerations()
})
