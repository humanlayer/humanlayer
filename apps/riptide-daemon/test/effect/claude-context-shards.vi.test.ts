import { it } from '@effect/vitest'
import type { Session } from '@humanlayer/db/tables/sessions'
import { Effect, Layer } from 'effect'
import { describe, expect, vi } from 'vitest'

import { loadClaudeContextShards } from '@/effects/services/claude-sessions/prepare-claude-session'
import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'

const shards = [
	{ id: '019e79fa-78d1-724e-bd84-3489bb3ec391', shardText: 'Start from the data structures.' },
	{ id: '019e79fa-78d1-724e-bd84-3489bb3ec392', shardText: 'Treat canary as mainline.' },
]

function makeInput(
	resumeSessionId?: string,
	forkMeta?: {
		agent: 'claude'
		forkFromCodingAgentSessionId: string
		forkAtCodingAgentEventId: string
	},
) {
	return {
		context: {
			session: {
				id: '019e79fa-78d1-724e-bd84-3489bb3ec390',
				organization_id: '019e79fa-78d1-724e-bd84-3489bb3ec393',
				resource_owner_user_id: 'user-1',
			} as Session,
			services: {} as never,
			interruptState: {} as never,
		},
		setupArtifactPaths: vi.fn(),
		resumeSessionId,
		forkMeta,
	}
}

describe('Effect-backed Claude context shards', () => {
	it.effect('loads enabled shards only for a fresh launch', () => {
		const listEnabledContextShards = vi.fn(async () => ({ data: shards }))
		const layer = Layer.succeed(DaemonApi, {
			listEnabledContextShards: () => Effect.promise(listEnabledContextShards),
		} as never)

		return Effect.gen(function* () {
			const fresh = yield* loadClaudeContextShards(makeInput())
			const resumed = yield* loadClaudeContextShards(makeInput('claude-session-id'))
			const forked = yield* loadClaudeContextShards(
				makeInput(undefined, {
					agent: 'claude',
					forkFromCodingAgentSessionId: 'source-session',
					forkAtCodingAgentEventId: 'source-event',
				}),
			)

			expect(fresh).toEqual(expect.any(String))
			expect(resumed).toBeNull()
			expect(forked).toBeNull()
			expect(listEnabledContextShards).toHaveBeenCalledTimes(1)
		}).pipe(Effect.provide(layer))
	})

	it.effect('continues without shards when the API request fails', () => {
		const layer = Layer.succeed(DaemonApi, {
			listEnabledContextShards: () => Effect.fail(new Error('unavailable')),
		} as never)

		return Effect.gen(function* () {
			expect(yield* loadClaudeContextShards(makeInput())).toBeNull()
		}).pipe(Effect.provide(layer))
	})
})
