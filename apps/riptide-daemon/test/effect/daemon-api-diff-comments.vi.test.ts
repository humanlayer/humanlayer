import { it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { describe, expect } from 'vitest'

import type { ORPCClient } from '@/agents/claudecode/types'
import { DaemonTaskCapabilityError } from '@/effects/services/daemon-api/daemon-api.errors'
import { DaemonApiLive } from '@/effects/services/daemon-api/daemon-api.layer'
import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'

import { createMockORPCClient } from '../mocks/orpc-client.mock'

describe('DaemonApi diff comments', () => {
	it.effect('forwards GitHub artifact backlink synchronization through the daemon adapter', () =>
		Effect.gen(function* () {
			const calls: Array<{ readonly input: unknown; readonly signal: AbortSignal }> = []
			type SyncArtifactBacklink = ORPCClient['integrations']['github']['syncArtifactBacklink']
			const client = createMockORPCClient({
				integrations: {
					github: {
						syncArtifactBacklink: async (
							input: Parameters<SyncArtifactBacklink>[0],
							options?: Parameters<SyncArtifactBacklink>[1],
						) => {
							if (!options?.signal) throw new Error('Expected interrupt signal')
							calls.push({ input, signal: options.signal })
							return { synced: true }
						},
					},
				},
			})

			const result = yield* Effect.gen(function* () {
				const api = yield* DaemonApi
				return yield* api.syncGitHubArtifactBacklink({ taskId: '11111111-1111-4111-8111-111111111111' })
			}).pipe(Effect.provide(DaemonApiLive(client)))

			expect(result).toEqual({ synced: true })
			expect(calls).toHaveLength(1)
			expect(calls[0]?.input).toEqual({ taskId: '11111111-1111-4111-8111-111111111111' })
			expect(calls[0]?.signal.aborted).toBe(false)
		}),
	)

	it.effect('forwards generated inputs and interrupt signals to each diff comment method', () =>
		Effect.gen(function* () {
			const calls: Array<{ readonly method: string; readonly input: unknown; readonly signal: AbortSignal }> = []
			type GetDiffComments = ORPCClient['diffComments']['get']
			type ReplyToDiffComment = ORPCClient['diffComments']['reply']
			type UpdateDiffComments = ORPCClient['diffComments']['update']
			const client = createMockORPCClient({
				diffComments: {
					get: async (input: Parameters<GetDiffComments>[0], options?: Parameters<GetDiffComments>[1]) => {
						if (!options?.signal) throw new Error('Expected interrupt signal')
						calls.push({ method: 'get', input, signal: options.signal })
						return { comments: [] }
					},
					reply: async (
						input: Parameters<ReplyToDiffComment>[0],
						options?: Parameters<ReplyToDiffComment>[1],
					) => {
						if (!options?.signal) throw new Error('Expected interrupt signal')
						calls.push({ method: 'reply', input, signal: options.signal })
						return {
							success: true,
							commentId: '11111111-1111-4111-8111-111111111111',
							parentCommentId: '22222222-2222-4222-8222-222222222222',
							transactionId: '1',
						}
					},
					update: async (
						input: Parameters<UpdateDiffComments>[0],
						options?: Parameters<UpdateDiffComments>[1],
					) => {
						if (!options?.signal) throw new Error('Expected interrupt signal')
						calls.push({ method: 'update', input, signal: options.signal })
						return { success: true, updated: [], failed: [], transactionId: '2' }
					},
				},
			})
			const program = Effect.gen(function* () {
				const api = yield* DaemonApi
				yield* api.getDiffComments({ taskId: '11111111-1111-4111-8111-111111111111', includeResolved: false })
				yield* api.replyToDiffComment({
					taskId: '11111111-1111-4111-8111-111111111111',
					truncatedCommentId: '11111111',
					contentText: 'Reply',
				})
				yield* api.updateDiffComments({
					taskId: '11111111-1111-4111-8111-111111111111',
					truncatedCommentIds: ['11111111'],
					resolved: true,
				})
			}).pipe(Effect.provide(DaemonApiLive(client)))

			yield* program
			expect(calls.map((call) => call.method)).toEqual(['get', 'reply', 'update'])
			expect(calls.every((call) => call.signal instanceof AbortSignal)).toBe(true)
			expect(calls[0]?.input).toEqual({
				taskId: '11111111-1111-4111-8111-111111111111',
				includeResolved: false,
			})
		}),
	)

	it.effect('narrows raw transport failures and keeps requests interruptible', () =>
		Effect.gen(function* () {
			const transportFailure = new Error('diff transport failed')
			let observedSignal: AbortSignal | undefined
			let requestCount = 0
			const requestStarted = Promise.withResolvers<void>()
			type GetDiffComments = ORPCClient['diffComments']['get']
			const client = createMockORPCClient({
				diffComments: {
					get: async (_input: Parameters<GetDiffComments>[0], options?: Parameters<GetDiffComments>[1]) => {
						requestCount += 1
						if (requestCount === 1) throw transportFailure
						const signal = options?.signal
						if (!signal) throw new Error('Expected interrupt signal')
						observedSignal = signal
						requestStarted.resolve()
						await new Promise<void>((_resolve, reject) => {
							signal.addEventListener('abort', () => reject(signal.reason), { once: true })
						})
						return { comments: [] }
					},
				},
			})
			const request = Effect.gen(function* () {
				const api = yield* DaemonApi
				return yield* api.getDiffComments({
					taskId: '11111111-1111-4111-8111-111111111111',
					includeResolved: false,
				})
			}).pipe(Effect.provide(DaemonApiLive(client)))

			const failure = yield* Effect.flip(request)
			expect(failure).toBeInstanceOf(DaemonTaskCapabilityError)
			expect(failure.cause).toBe(transportFailure)

			const fiber = yield* Effect.forkChild(request)
			yield* Effect.promise(() => requestStarted.promise)
			yield* Fiber.interrupt(fiber)
			expect(observedSignal?.aborted).toBe(true)
		}),
	)
})
