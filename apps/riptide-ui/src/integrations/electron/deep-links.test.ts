import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'
import { TestClock } from 'effect/testing'

import { ElectronRpcClient, type ElectronRpcClientShape } from '@/effects/electron-rpc/electron-rpc-client.service'

import { subscribeToDeepLinks } from './deep-links'

describe('Electron deep links', () => {
	it.effect('delivers streamed deep links to the callback', () =>
		Effect.gen(function* () {
			const links = yield* Queue.unbounded<{ readonly url: string }>()
			const delivered: string[] = []
			const client = {
				DeepLinkEvents: () => Stream.fromEffectRepeat(Queue.take(links)),
			} as unknown as ElectronRpcClientShape

			const fiber = yield* subscribeToDeepLinks((link) => delivered.push(link.url)).pipe(
				Effect.provide(Layer.succeed(ElectronRpcClient, client)),
				Effect.forkChild,
			)
			yield* Effect.yieldNow
			yield* Queue.offer(links, { url: 'humanlayer-electron-dev://oauth/callback?code=one' })
			yield* Effect.yieldNow

			expect(delivered).toEqual(['humanlayer-electron-dev://oauth/callback?code=one'])
			yield* Fiber.interrupt(fiber)
		}),
	)

	it.effect('resubscribes after the stream fails', () =>
		Effect.gen(function* () {
			let subscriptions = 0
			const delivered: string[] = []
			const links = yield* Queue.unbounded<{ readonly url: string }>()
			const client = {
				DeepLinkEvents: () => {
					subscriptions += 1
					return subscriptions === 1
						? Stream.fail(new Error('connection lost'))
						: Stream.fromEffectRepeat(Queue.take(links))
				},
			} as unknown as ElectronRpcClientShape

			const fiber = yield* subscribeToDeepLinks((link) => delivered.push(link.url)).pipe(
				Effect.provide(Layer.succeed(ElectronRpcClient, client)),
				Effect.forkChild,
			)
			yield* Effect.yieldNow
			expect(subscriptions).toBe(1)
			expect(delivered).toEqual([])

			yield* TestClock.adjust('1 second')
			yield* Effect.yieldNow
			expect(subscriptions).toBe(2)

			yield* Queue.offer(links, { url: 'humanlayer-electron-dev://oauth/callback?code=two' })
			yield* Effect.yieldNow
			expect(delivered).toEqual(['humanlayer-electron-dev://oauth/callback?code=two'])
			yield* Fiber.interrupt(fiber)
		}),
	)
})
