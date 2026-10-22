import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { DaemonApiLive } from '../../src/effects/services/daemon-api/daemon-api.layer'
import { DaemonApi } from '../../src/effects/services/daemon-api/daemon-api.service'
import { createMockORPCClient } from '../mocks/orpc-client.mock'

describe('DaemonApi', () => {
	it('allows one retry when ensuring a conversation stream', async () => {
		const ensureStreamHydrated = vi.fn(async () => ({ streams: [] }))
		const client = createMockORPCClient({ sessions: { ensureStreamHydrated } })
		const input = { sessionId: '019550cd-e554-7000-8000-000000000001' }

		await Effect.runPromise(
			Effect.gen(function* () {
				const api = yield* DaemonApi
				yield* api.ensureConversationStream(input)
			}).pipe(Effect.provide(DaemonApiLive(client))),
		)

		expect(ensureStreamHydrated).toHaveBeenCalledWith(input, {
			signal: expect.any(AbortSignal),
			context: { retry: 1 },
		})
	})
})
