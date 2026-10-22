import { describe, it } from '@effect/vitest'
import { Effect, Fiber, Queue, Stream } from 'effect'

import type { DaemonServices } from '@/agents/claudecode/types'
import {
	DaemonCollectionsLive,
	filterAutomationSessionChanges,
} from '@/effects/services/daemon-collections/daemon-collections.layer'
import { DaemonCollections } from '@/effects/services/daemon-collections/daemon-collections.service'

import { makeSessionChange } from '../helpers/session-fixtures'

describe('DaemonCollections', () => {
	it.effect('filters the automation session stream to the prepared target', ({ expect }) =>
		Effect.gen(function* () {
			const changes = [
				makeSessionChange({ type: 'insert', value: { id: 'unrelated-session', status: 'ready_for_launch' } }),
				makeSessionChange({ type: 'insert', value: { id: 'target-session', status: 'ready_for_launch' } }),
			]
			const filtered = yield* filterAutomationSessionChanges(Stream.fromIterable(changes), 'target-session').pipe(
				Stream.runCollect,
			)
			expect(Array.from(filtered).map((change) => change.value.id)).toEqual(['target-session'])
		}),
	)

	it.effect('streams only later changes for the requested session and releases its subscription', ({ expect }) =>
		Effect.gen(function* () {
			const subscribed = yield* Queue.unbounded<void>()
			let listener: (changes: ReturnType<typeof makeSessionChange>[]) => void = () => undefined
			let includeInitialState: boolean | undefined
			let unsubscribeCount = 0
			const initial = makeSessionChange({
				type: 'insert',
				value: { id: 'target-session', status: 'interrupt_requested' },
			})
			const sessions = {
				subscribeChanges: (callback: typeof listener, options: { readonly includeInitialState?: boolean }) => {
					listener = callback
					includeInitialState = options.includeInitialState
					if (options.includeInitialState !== false) callback([initial])
					Queue.offerUnsafe(subscribed, undefined)
					return { unsubscribe: () => unsubscribeCount++ }
				},
			}
			const inertCollection = {
				subscribeChanges: () => ({ unsubscribe: () => undefined }),
			}
			const collections = {
				sessions,
				tasks: inertCollection,
				approvals: inertCollection,
				workspaceSetup: inertCollection,
			} as unknown as DaemonServices['collections']

			const program = Effect.gen(function* () {
				const service = yield* DaemonCollections
				const fiber = yield* service
					.streamSessionChanges('target-session')
					.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
				yield* Queue.take(subscribed)
				expect(includeInitialState).toBe(false)

				listener([
					makeSessionChange({ type: 'update', value: { id: 'other-session', status: 'running' } }),
					makeSessionChange({ type: 'update', value: { id: 'target-session', status: 'running' } }),
				])
				const changes = yield* Fiber.join(fiber)

				expect(Array.from(changes).map((change) => change.value.id)).toEqual(['target-session'])
				expect(Array.from(changes).map((change) => change.value.status)).toEqual(['running'])
				expect(unsubscribeCount).toBe(1)
			})

			yield* program.pipe(Effect.scoped, Effect.provide(DaemonCollectionsLive(collections)))
		}),
	)
})
