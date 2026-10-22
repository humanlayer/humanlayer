import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'

import type { ElectronConfig } from '../src/config/electron-config'
import { DeepLinkPlatform } from '../src/deep-links/deep-link-platform.service'
import { DeepLinkService } from '../src/deep-links/deep-link-service'
import { makeDeepLinkServiceLive } from '../src/deep-links/deep-link-service.layer'

const config = (isPackaged: boolean): ElectronConfig => ({
	channel: 'prod',
	isPackaged,
	userDataPath: '/test/profile',
	homeDirectory: '/test/home',
	devstackId: undefined,
	rendererUrl: new URL('file:///renderer/index.html'),
	applicationIconPath: undefined,
	remoteDebuggingPort: 9222,
	cdpEnabled: false,
	openDevTools: false,
	logPath: '/test/electron.log',
	daemonMode: 'external',
	protocolSchemes: ['humanlayer-electron'],
})

describe('DeepLinkService', () => {
	it.effect('buffers all configured cold-start links and ignores other arguments', () => {
		const platform = Layer.succeed(
			DeepLinkPlatform,
			DeepLinkPlatform.of({
				initialArguments: [
					'app',
					'--flag',
					'humanlayer-electron://oauth/callback?code=one',
					'https://example.com',
				],
				incomingArguments: Stream.empty,
				registerProtocolClient: () => Effect.succeed(true),
				ownsProtocol: () => Effect.succeed(true),
				focusMainWindow: Effect.void,
			}),
		)

		return Effect.gen(function* () {
			const deepLinks = yield* DeepLinkService
			yield* deepLinks.enableWindowActivation
			expect(Option.isSome(yield* Stream.runHead(deepLinks.windowActivationRequests))).toBe(true)
			expect(yield* deepLinks.takePending).toEqual({ url: 'humanlayer-electron://oauth/callback?code=one' })
			expect(yield* deepLinks.takePending).toBeNull()
		}).pipe(Effect.provide(makeDeepLinkServiceLive(config(false)).pipe(Layer.provide(platform))))
	})

	it.effect('streams warm links and focuses the main window', () =>
		Effect.gen(function* () {
			const incoming = yield* Queue.unbounded<ReadonlyArray<string>>()
			const focused = yield* Queue.unbounded<void>()
			const platform = Layer.succeed(
				DeepLinkPlatform,
				DeepLinkPlatform.of({
					initialArguments: [],
					incomingArguments: Stream.fromQueue(incoming),
					registerProtocolClient: () => Effect.succeed(true),
					ownsProtocol: () => Effect.succeed(true),
					focusMainWindow: Queue.offer(focused, undefined),
				}),
			)
			const program = Effect.gen(function* () {
				const deepLinks = yield* DeepLinkService
				const eventFiber = yield* deepLinks.events.pipe(Stream.runHead, Effect.forkChild)
				yield* Queue.offer(incoming, ['humanlayer-electron://nav/tasks/task-1'])
				yield* Queue.take(focused)
				expect(Option.getOrThrow(yield* Fiber.join(eventFiber))).toEqual({
					url: 'humanlayer-electron://nav/tasks/task-1',
				})
				expect(yield* deepLinks.takePending).toBeNull()
			})
			yield* program.pipe(Effect.provide(makeDeepLinkServiceLive(config(false)).pipe(Layer.provide(platform))))
		}),
	)

	it.effect('delivers each link once across competing subscribers', () =>
		Effect.gen(function* () {
			const incoming = yield* Queue.unbounded<ReadonlyArray<string>>()
			const platform = Layer.succeed(
				DeepLinkPlatform,
				DeepLinkPlatform.of({
					initialArguments: [],
					incomingArguments: Stream.fromQueue(incoming),
					registerProtocolClient: () => Effect.succeed(true),
					ownsProtocol: () => Effect.succeed(true),
					focusMainWindow: Effect.void,
				}),
			)
			yield* Effect.gen(function* () {
				const deepLinks = yield* DeepLinkService
				const first = yield* deepLinks.events.pipe(Stream.runHead, Effect.forkChild)
				const second = yield* deepLinks.events.pipe(Stream.runHead, Effect.forkChild)
				yield* Queue.offer(incoming, ['humanlayer-electron://nav/tasks/one'])
				yield* Queue.offer(incoming, ['humanlayer-electron://nav/tasks/two'])
				const urls = [
					Option.getOrThrow(yield* Fiber.join(first)).url,
					Option.getOrThrow(yield* Fiber.join(second)).url,
				]
				expect(urls.sort()).toEqual([
					'humanlayer-electron://nav/tasks/one',
					'humanlayer-electron://nav/tasks/two',
				])
				expect(yield* deepLinks.takePending).toBeNull()
			}).pipe(Effect.provide(makeDeepLinkServiceLive(config(false)).pipe(Layer.provide(platform))))
		}),
	)

	it.effect('hands queued links between pending drain and stream consumption without loss', () =>
		Effect.gen(function* () {
			const incoming = yield* Queue.unbounded<ReadonlyArray<string>>()
			const platform = Layer.succeed(
				DeepLinkPlatform,
				DeepLinkPlatform.of({
					initialArguments: ['app', 'humanlayer-electron://oauth/callback?code=cold'],
					incomingArguments: Stream.fromQueue(incoming),
					registerProtocolClient: () => Effect.succeed(true),
					ownsProtocol: () => Effect.succeed(true),
					focusMainWindow: Effect.void,
				}),
			)
			yield* Effect.gen(function* () {
				const deepLinks = yield* DeepLinkService
				expect(yield* deepLinks.takePending).toEqual({
					url: 'humanlayer-electron://oauth/callback?code=cold',
				})
				const warm = yield* deepLinks.events.pipe(Stream.runHead, Effect.forkChild)
				yield* Queue.offer(incoming, ['humanlayer-electron://nav/tasks/warm'])
				expect(Option.getOrThrow(yield* Fiber.join(warm))).toEqual({
					url: 'humanlayer-electron://nav/tasks/warm',
				})
				expect(yield* deepLinks.takePending).toBeNull()
			}).pipe(Effect.provide(makeDeepLinkServiceLive(config(false)).pipe(Layer.provide(platform))))
		}),
	)

	it.effect('registers and verifies the packaged channel scheme', () => {
		const registrations: string[] = []
		const verifications: string[] = []
		const platform = Layer.succeed(
			DeepLinkPlatform,
			DeepLinkPlatform.of({
				initialArguments: [],
				incomingArguments: Stream.empty,
				registerProtocolClient: ({ scheme }) =>
					Effect.sync(() => registrations.push(scheme)).pipe(Effect.as(true)),
				ownsProtocol: ({ scheme }) => Effect.sync(() => verifications.push(scheme)).pipe(Effect.as(true)),
				focusMainWindow: Effect.void,
			}),
		)

		return DeepLinkService.use((deepLinks) => deepLinks.initializePackagedProtocolClients).pipe(
			Effect.provide(makeDeepLinkServiceLive(config(true)).pipe(Layer.provide(platform))),
			Effect.tap(() =>
				Effect.sync(() => {
					expect(registrations).toEqual(['humanlayer-electron'])
					expect(verifications).toEqual(['humanlayer-electron'])
				}),
			),
		)
	})
})
