import { describe, it } from '@effect/vitest'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import { expect } from 'vitest'

import { DaemonInstanceAlreadyRunning } from '@/effects/services/daemon-instance-lock'
import { loadDaemonIdentity } from '@/lib/auth'
import { deriveHeartbeatCapabilities, startHeartbeat } from '@/lib/heartbeat'
import { HostUsageLimits, HostUsageLimitsLive } from '@/lib/usage-limits/host-usage-limits'
import {
	DaemonIdentityLoader,
	type DaemonIdentityLoaderShape,
	type ManagedDaemonConfigurationError,
	ManagedDaemonIdentityError,
	ManagedDaemonRuntimeLauncher,
	type ManagedDaemonRuntimeLauncherShape,
	ManagedDaemonStartupError,
	loadResolvedManagedDaemonLaunchRequestAtHostBoundary,
	runManagedDaemonStart as runResolvedManagedDaemonStart,
} from '@/managed-daemon-start'

import { makeHostMachineStatsTestLayer } from '../helpers/host-machine-stats'

const identity = {
	authenticationMode: 'authenticated' as const,
	token: 'resolved-daemon-token',
	hostId: 'host-1',
	identity: {
		userId: 'user-1',
		organizationId: 'org-1',
		hostId: 'host-1',
	},
}

const runManagedDaemonStart = (config: Parameters<typeof loadResolvedManagedDaemonLaunchRequestAtHostBoundary>[0]) =>
	loadResolvedManagedDaemonLaunchRequestAtHostBoundary(config).pipe(Effect.flatMap(runResolvedManagedDaemonStart))

const completeConfig = {
	token: 'input-daemon-token',
	apiOrigin: 'https://api.input.example.com',
	syncOrigin: 'https://sync.input.example.com',
	stage: 'dev',
	generationId: 'generation-1',
	expectedIdentity: null,
} as const

const defaultAutomationLifecycle = {
	shutdownOn: 'inactivity',
	inactivityMs: 120_000,
	onFailure: 'inactivity',
} as const

const makeManagedDaemonTestLayer = (
	identityLoader: DaemonIdentityLoaderShape,
	runtimeLauncher: ManagedDaemonRuntimeLauncherShape,
) =>
	Layer.mergeAll(
		Layer.succeed(DaemonIdentityLoader, identityLoader),
		Layer.succeed(ManagedDaemonRuntimeLauncher, runtimeLauncher),
	)

type ManagedDaemonStartError = ManagedDaemonConfigurationError | ManagedDaemonIdentityError | ManagedDaemonStartupError

const expectConfigurationFailure = <A, R>(effect: Effect.Effect<A, ManagedDaemonStartError, R>, message: string) =>
	effect.pipe(
		Effect.flatMap(() => Effect.die(`Expected ManagedDaemonConfigurationError: ${message}`)),
		Effect.catchTag('ManagedDaemonConfigurationError', (error) =>
			Effect.sync(() => {
				expect(error.message).toBe(message)
				expect(error.cause).toBeDefined()
			}),
		),
	)

const expectIdentityFailure = <A, R>(
	effect: Effect.Effect<A, ManagedDaemonStartError, R>,
	assertFailure: (error: ManagedDaemonIdentityError) => void,
) =>
	effect.pipe(
		Effect.flatMap(() => Effect.die('Expected ManagedDaemonIdentityError')),
		Effect.catchTag('ManagedDaemonIdentityError', (error) => Effect.sync(() => assertFailure(error))),
	)

describe('runManagedDaemonStart', () => {
	it.effect(
		'returns daemon_ready only after the runtime launcher completes and passes the resolved identity token to the runtime boundary',
		() =>
			Effect.gen(function* () {
				const launchRequests =
					yield* Queue.unbounded<Parameters<ManagedDaemonRuntimeLauncherShape['launch']>[0]>()
				const allowRuntimeInitializationToComplete = yield* Deferred.make<void>()
				const startupCompleted = yield* Ref.make(false)
				const layer = makeManagedDaemonTestLayer(
					{ load: () => Effect.succeed(identity) },
					{
						launch: (request) =>
							Queue.offer(launchRequests, request).pipe(
								Effect.andThen(Deferred.await(allowRuntimeInitializationToComplete)),
							),
					},
				)

				const startupFiber = yield* runManagedDaemonStart(completeConfig).pipe(
					Effect.provide(layer),
					Effect.tap(() => Ref.set(startupCompleted, true)),
					Effect.forkChild,
				)
				const launchRequest = yield* Queue.take(launchRequests)

				expect(launchRequest).toEqual({
					config: {
						token: identity.token,
						apiOrigin: completeConfig.apiOrigin,
						syncOrigin: completeConfig.syncOrigin,
						stage: completeConfig.stage,
						generationId: completeConfig.generationId,
						automation: null,
					},
					identity,
				})
				expect(deriveHeartbeatCapabilities(launchRequest.config, false)).toEqual({
					distribution: 'desktop',
					canSelfUpdate: false,
					ephemeral: false,
				})
				expect(yield* Ref.get(startupCompleted)).toBe(false)

				yield* Deferred.succeed(allowRuntimeInitializationToComplete, undefined)
				expect(yield* Fiber.join(startupFiber)).toEqual({ type: 'daemon_ready' })
			}),
	)

	it.effect('passes validated automation target and lifecycle configuration to the runtime boundary', () =>
		Effect.gen(function* () {
			const launchRequests = yield* Queue.unbounded<Parameters<ManagedDaemonRuntimeLauncherShape['launch']>[0]>()
			const layer = makeManagedDaemonTestLayer(
				{ load: () => Effect.succeed(identity) },
				{ launch: (request) => Queue.offer(launchRequests, request).pipe(Effect.asVoid) },
			)
			const automation = {
				targetSessionId: '019dc715-3333-7777-8888-999999999999',
				lifecycle: defaultAutomationLifecycle,
			} as const

			yield* runManagedDaemonStart({ ...completeConfig, automation, selfUpdate: null }).pipe(
				Effect.provide(layer),
			)
			const request = yield* Queue.take(launchRequests)
			expect(request.config.automation).toEqual(automation)
			expect(deriveHeartbeatCapabilities(request.config, false)).toEqual({
				distribution: 'cli',
				canSelfUpdate: false,
				ephemeral: true,
			})
		}),
	)

	it.effect('ordinary CLI launches remain non-ephemeral with or without self-update support', () =>
		Effect.gen(function* () {
			const launchRequests = yield* Queue.unbounded<Parameters<ManagedDaemonRuntimeLauncherShape['launch']>[0]>()
			const layer = makeManagedDaemonTestLayer(
				{ load: () => Effect.succeed(identity) },
				{ launch: (request) => Queue.offer(launchRequests, request).pipe(Effect.asVoid) },
			)
			const selfUpdateCapability = {
				packageSpecifier: '@humanlayer/cli@latest',
				restart: { command: 'humanlayer', args: ['daemon', 'launch'] },
				supervisor: 'none',
			} as const
			for (const selfUpdate of [null, selfUpdateCapability]) {
				yield* runManagedDaemonStart({ ...completeConfig, selfUpdate }).pipe(Effect.provide(layer))
				const request = yield* Queue.take(launchRequests)
				expect(deriveHeartbeatCapabilities(request.config, selfUpdate !== null)).toEqual({
					distribution: 'cli',
					canSelfUpdate: selfUpdate !== null,
					ephemeral: false,
				})
			}
		}),
	)

	it.effect('returns the bounded automation result produced after runtime shutdown', () =>
		Effect.gen(function* () {
			const automationResult = {
				type: 'automation_complete',
				completionReason: 'inactivity',
				finalStatus: 'ready_for_input',
			} as const
			const layer = makeManagedDaemonTestLayer(
				{ load: () => Effect.succeed(identity) },
				{ launch: () => Effect.succeed(automationResult) },
			)

			const result = yield* runManagedDaemonStart({
				...completeConfig,
				automation: {
					targetSessionId: '019dc715-3333-7777-8888-999999999999',
					lifecycle: defaultAutomationLifecycle,
				},
			}).pipe(Effect.provide(layer))

			expect(result).toEqual(automationResult)
		}),
	)

	const heartbeatCapabilities = { distribution: 'cli', canSelfUpdate: false, ephemeral: false } as const

	const makeHeartbeatSpy = () => {
		let calls = 0
		const waiters: Array<{ count: number; resolve: () => void }> = []
		const release = () => {
			for (const waiter of waiters.splice(0)) {
				if (calls >= waiter.count) waiter.resolve()
				else waiters.push(waiter)
			}
		}
		return {
			calls: () => calls,
			record: () => {
				calls++
				release()
			},
			calledTimes: (count: number) =>
				calls >= count ? Promise.resolve() : new Promise<void>((resolve) => waiters.push({ count, resolve })),
		}
	}

	it('waits for the initial host heartbeat before reporting heartbeat startup complete', async () => {
		const runtime = ManagedRuntime.make(Layer.mergeAll(HostUsageLimitsLive, makeHostMachineStatsTestLayer()))
		let releaseInitialHeartbeat: (() => void) | undefined
		const initialHeartbeatGate = new Promise<void>((resolve) => {
			releaseInitialHeartbeat = resolve
		})
		const spy = makeHeartbeatSpy()
		let firstHeartbeatInput: unknown
		const orpc = {
			hosts: {
				heartbeat: async (input: unknown) => {
					spy.record()
					firstHeartbeatInput ??= input
					await initialHeartbeatGate
					return { updateRequest: null }
				},
			},
		} as never
		const startup = startHeartbeat(runtime, 'host-1', orpc, heartbeatCapabilities)
		let startupCompleted = false
		void startup.then(() => {
			startupCompleted = true
		})

		await spy.calledTimes(1)
		expect(spy.calls()).toBe(1)
		expect(startupCompleted).toBe(false)
		releaseInitialHeartbeat?.()
		const heartbeat = await startup
		expect(startupCompleted).toBe(true)
		expect(firstHeartbeatInput).toMatchObject({ distribution: 'cli', canSelfUpdate: false, ephemeral: false })
		heartbeat.stop()
		await runtime.dispose()
	})

	it('rejects startup when the registering heartbeat fails', async () => {
		const runtime = ManagedRuntime.make(Layer.mergeAll(HostUsageLimitsLive, makeHostMachineStatsTestLayer()))
		const orpc = {
			hosts: {
				heartbeat: async () => {
					throw Object.assign(new Error('host not found'), { status: 404 })
				},
			},
		} as never
		await expect(startHeartbeat(runtime, 'host-1', orpc, heartbeatCapabilities)).rejects.toMatchObject({
			_tag: 'HeartbeatError',
			cause: expect.objectContaining({ message: 'host not found' }),
		})
		await runtime.dispose()
	})

	it('sends one extra heartbeat shortly after usage limits change', async () => {
		const runtime = ManagedRuntime.make(Layer.mergeAll(HostUsageLimitsLive, makeHostMachineStatsTestLayer()))
		const spy = makeHeartbeatSpy()
		const reported: unknown[] = []
		const orpc = {
			hosts: {
				heartbeat: async (input: { codingAgentUsageLimits?: unknown }) => {
					spy.record()
					reported.push(input.codingAgentUsageLimits)
					return { updateRequest: null }
				},
			},
		} as never
		const heartbeat = await startHeartbeat(runtime, 'host-1', orpc, heartbeatCapabilities)
		expect(reported).toEqual([undefined])

		await runtime.runPromise(
			Effect.flatMap(HostUsageLimits, (usageLimits) =>
				Effect.all([
					usageLimits.applyClaudeRateLimitEvent({
						status: 'allowed',
						rateLimitType: 'five_hour',
						utilization: 0.4,
					}),
					usageLimits.applyClaudeRateLimitEvent({
						status: 'allowed',
						rateLimitType: 'five_hour',
						utilization: 0.5,
					}),
				]),
			),
		)
		await spy.calledTimes(2)
		expect(spy.calls()).toBe(2)
		expect(reported[1]).toMatchObject({ claude: { windows: { five_hour: { used_percent: 50 } } } })
		heartbeat.stop()
		await runtime.dispose()
	})

	it('uses injected automation token claims even when local daemon credential loading is configured', async () => {
		const previousLoadCredentials = process.env.RIPTIDE_DAEMON_LOAD_CREDS
		process.env.RIPTIDE_DAEMON_LOAD_CREDS = 'true'
		const injectedClaims = {
			userId: 'automation-user',
			organizationId: 'automation-organization',
			hostId: 'automation-host',
		}
		const token = `header.${Buffer.from(JSON.stringify(injectedClaims)).toString('base64url')}.signature`
		try {
			const loaded = await loadDaemonIdentity(token)
			expect(loaded).toMatchObject({ authenticationMode: 'authenticated', hostId: 'automation-host' })
			if (loaded.authenticationMode === 'authenticated') expect(loaded.identity).toEqual(injectedClaims)
		} finally {
			if (previousLoadCredentials === undefined) delete process.env.RIPTIDE_DAEMON_LOAD_CREDS
			else process.env.RIPTIDE_DAEMON_LOAD_CREDS = previousLoadCredentials
		}
	})

	it.effect('preserves every valid explicit stage and required origins at the runtime boundary', () =>
		Effect.gen(function* () {
			const launchRequests = yield* Queue.unbounded<Parameters<ManagedDaemonRuntimeLauncherShape['launch']>[0]>()
			const layer = makeManagedDaemonTestLayer(
				{ load: () => Effect.succeed(identity) },
				{ launch: (request) => Queue.offer(launchRequests, request).pipe(Effect.asVoid) },
			)

			for (const stage of ['local', 'dev', 'beta', 'prod'] as const) {
				const result = yield* runManagedDaemonStart({ ...completeConfig, stage }).pipe(Effect.provide(layer))
				const request = yield* Queue.take(launchRequests)
				expect(result).toEqual({ type: 'daemon_ready' })
				expect(request.config).toMatchObject({
					apiOrigin: completeConfig.apiOrigin,
					syncOrigin: completeConfig.syncOrigin,
					stage,
				})
			}
		}),
	)

	it.effect('rejects empty token and origins before identity loading or runtime launch', () =>
		Effect.gen(function* () {
			const identityLoadCount = yield* Ref.make(0)
			const runtimeLaunchCount = yield* Ref.make(0)
			const layer = makeManagedDaemonTestLayer(
				{ load: () => Ref.update(identityLoadCount, (count) => count + 1).pipe(Effect.as(identity)) },
				{ launch: () => Ref.update(runtimeLaunchCount, (count) => count + 1) },
			)

			for (const field of ['token', 'apiOrigin', 'syncOrigin'] as const) {
				yield* expectConfigurationFailure(
					runManagedDaemonStart({ ...completeConfig, [field]: '' }).pipe(Effect.provide(layer)),
					'Managed daemon configuration is invalid',
				)
			}

			expect(yield* Ref.get(identityLoadCount)).toBe(0)
			expect(yield* Ref.get(runtimeLaunchCount)).toBe(0)
		}),
	)

	it.effect('accepts a matching expected authenticated identity before launching the runtime', () =>
		Effect.gen(function* () {
			const runtimeLaunchCount = yield* Ref.make(0)
			const layer = makeManagedDaemonTestLayer(
				{ load: () => Effect.succeed(identity) },
				{ launch: () => Ref.update(runtimeLaunchCount, (count) => count + 1) },
			)
			const result = yield* runManagedDaemonStart({
				...completeConfig,
				expectedIdentity: identity.identity,
			}).pipe(Effect.provide(layer))
			expect(result).toEqual({ type: 'daemon_ready' })
			expect(yield* Ref.get(runtimeLaunchCount)).toBe(1)
		}),
	)

	it.effect(
		'accepts an expected identity whose organization id differs because launchers and tokens use different organization id namespaces',
		() =>
			Effect.gen(function* () {
				const runtimeLaunchCount = yield* Ref.make(0)
				const layer = makeManagedDaemonTestLayer(
					{ load: () => Effect.succeed(identity) },
					{ launch: () => Ref.update(runtimeLaunchCount, (count) => count + 1) },
				)
				const result = yield* runManagedDaemonStart({
					...completeConfig,
					expectedIdentity: { ...identity.identity, organizationId: 'org_workos-1' },
				}).pipe(Effect.provide(layer))
				expect(result).toEqual({ type: 'daemon_ready' })
				expect(yield* Ref.get(runtimeLaunchCount)).toBe(1)
			}),
	)

	it.effect('fails with a typed identity error and never launches for any mismatching identity field', () =>
		Effect.gen(function* () {
			for (const expectedIdentity of [
				{ ...identity.identity, userId: 'different-user' },
				{ ...identity.identity, hostId: 'different-host' },
			]) {
				const runtimeLaunchCount = yield* Ref.make(0)
				const layer = makeManagedDaemonTestLayer(
					{ load: () => Effect.succeed(identity) },
					{ launch: () => Ref.update(runtimeLaunchCount, (count) => count + 1) },
				)
				yield* expectIdentityFailure(
					runManagedDaemonStart({ ...completeConfig, expectedIdentity }).pipe(Effect.provide(layer)),
					(error) => {
						expect(error.message).toBe(
							'Authenticated daemon identity does not match the identity requested by the launcher',
						)
						expect(error.cause).toEqual({ expectedIdentity, actualIdentity: identity.identity })
					},
				)
				expect(yield* Ref.get(runtimeLaunchCount)).toBe(0)
			}
		}),
	)

	it.effect(
		'allows a null token in skip-auth mode and uses the loaded runtime token without comparing identity',
		() =>
			Effect.gen(function* () {
				const launchRequests =
					yield* Queue.unbounded<Parameters<ManagedDaemonRuntimeLauncherShape['launch']>[0]>()
				const skipAuthIdentity = {
					authenticationMode: 'skip-auth' as const,
					token: 'test-token-skip-auth',
					hostId: 'host-1',
				}
				const layer = makeManagedDaemonTestLayer(
					{
						load: ({ token }) =>
							Effect.sync(() => expect(token).toBeNull()).pipe(Effect.as(skipAuthIdentity)),
					},
					{ launch: (request) => Queue.offer(launchRequests, request).pipe(Effect.asVoid) },
				)
				const result = yield* runManagedDaemonStart({
					...completeConfig,
					token: null,
					expectedIdentity: identity.identity,
				}).pipe(Effect.provide(layer))
				expect(result).toEqual({ type: 'daemon_ready' })
				expect((yield* Queue.take(launchRequests)).config.token).toBe(skipAuthIdentity.token)
			}),
	)

	it.effect(
		'fails with ManagedDaemonConfigurationError before identity loading or runtime launch when the stage boundary cannot decode the input',
		() =>
			Effect.gen(function* () {
				const identityLoadCount = yield* Ref.make(0)
				const runtimeLaunchCount = yield* Ref.make(0)
				const layer = makeManagedDaemonTestLayer(
					{
						load: () => Ref.update(identityLoadCount, (count) => count + 1).pipe(Effect.as(identity)),
					},
					{
						launch: () => Ref.update(runtimeLaunchCount, (count) => count + 1),
					},
				)

				yield* expectConfigurationFailure(
					runManagedDaemonStart({ ...completeConfig, stage: 'stable' }).pipe(Effect.provide(layer)),
					'Managed daemon configuration is invalid',
				)

				expect(yield* Ref.get(identityLoadCount)).toBe(0)
				expect(yield* Ref.get(runtimeLaunchCount)).toBe(0)
			}),
	)

	it.effect(
		'returns daemon_already_running as a successful launch result after identity resolution without converting contention into startup failure',
		() =>
			Effect.gen(function* () {
				const launchRequests =
					yield* Queue.unbounded<Parameters<ManagedDaemonRuntimeLauncherShape['launch']>[0]>()
				const contention = new DaemonInstanceAlreadyRunning({
					userId: identity.identity.userId,
					organizationId: identity.identity.organizationId,
					hostId: identity.identity.hostId,
					stage: 'prod',
					lockPath: '/tmp/daemon.lock',
				})
				const layer = makeManagedDaemonTestLayer(
					{ load: () => Effect.succeed(identity) },
					{
						launch: (request) =>
							Queue.offer(launchRequests, request).pipe(Effect.andThen(Effect.fail(contention))),
					},
				)

				const result = yield* runManagedDaemonStart({ ...completeConfig, stage: 'prod' }).pipe(
					Effect.provide(layer),
				)

				expect(result).toEqual({
					type: 'daemon_already_running',
					message: 'A daemon is already running for this user, organization, host, and stage',
				})
				expect((yield* Queue.take(launchRequests)).config.stage).toBe('prod')
			}),
	)

	it.effect('preserves a typed identity loading failure and never crosses the runtime launcher boundary', () =>
		Effect.gen(function* () {
			const runtimeLaunchCount = yield* Ref.make(0)
			const identityFailure = new ManagedDaemonIdentityError({
				message: 'Failed to load daemon identity',
				cause: new Error('token rejected'),
			})
			const layer = makeManagedDaemonTestLayer(
				{ load: () => Effect.fail(identityFailure) },
				{ launch: () => Ref.update(runtimeLaunchCount, (count) => count + 1) },
			)

			yield* expectIdentityFailure(runManagedDaemonStart(completeConfig).pipe(Effect.provide(layer)), (error) => {
				expect(error).toBe(identityFailure)
				expect(error.message).toBe('Failed to load daemon identity')
				expect(error.cause).toEqual(new Error('token rejected'))
			})
			expect(yield* Ref.get(runtimeLaunchCount)).toBe(0)
		}),
	)

	it.effect(
		'preserves typed runtime initialization failure and runs the launcher resource finalizer exactly once before returning the failure',
		() =>
			Effect.gen(function* () {
				const acquiredLeaseCount = yield* Ref.make(0)
				const releasedLeaseCount = yield* Ref.make(0)
				const initializationFailure = new ManagedDaemonStartupError({
					message: 'Failed to initialize daemon runtime',
					cause: new Error('initialization failed'),
				})
				const layer = makeManagedDaemonTestLayer(
					{ load: () => Effect.succeed(identity) },
					{
						launch: () =>
							Effect.acquireUseRelease(
								Ref.update(acquiredLeaseCount, (count) => count + 1),
								() => Effect.fail(initializationFailure),
								() => Ref.update(releasedLeaseCount, (count) => count + 1),
							),
					},
				)

				const failure = yield* runManagedDaemonStart(completeConfig).pipe(Effect.provide(layer), Effect.flip)

				expect(failure).toBe(initializationFailure)
				expect(yield* Ref.get(acquiredLeaseCount)).toBe(1)
				expect(yield* Ref.get(releasedLeaseCount)).toBe(1)
			}),
	)
})
