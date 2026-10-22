import { describe, expect, it } from 'vitest'

import { readSetup, type WorkspaceStatus } from '@/minimalist/lib/workspace-setup'

const status = (...repositories: Array<{ status: string; error?: object }>) =>
	({
		materializations: [{ repositories: repositories.map((status) => ({ status })) }],
	}) as unknown as WorkspaceStatus

describe('readSetup', () => {
	it('has not settled before the host reports any repository', () => {
		expect(readSetup(undefined).settled).toBe(false)
		expect(readSetup(status()).settled).toBe(false)
	})

	it('names the repository still being set up', () => {
		const setup = readSetup(status({ status: 'done' }, { status: 'cloning_source' }))
		expect(setup.working?.status.status).toBe('cloning_source')
		expect(setup.settled).toBe(false)
	})

	it('settles when every repository is done, or when one fails', () => {
		expect(readSetup(status({ status: 'done' }, { status: 'done' })).settled).toBe(true)
		const failed = readSetup(
			status(
				{ status: 'refreshing_source', error: { stage: 'refreshing_source' } },
				{ status: 'cloning_source' },
			),
		)
		expect(failed.failed?.status.status).toBe('refreshing_source')
		expect(failed.settled).toBe(true)
	})
})
