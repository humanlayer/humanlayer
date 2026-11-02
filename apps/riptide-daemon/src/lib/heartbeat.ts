import { hostname } from 'node:os'

import { DAEMON_CAPABILITIES } from '@humanlayer/riptide-api-contract/daemon/heartbeat'
import type { HostModelCatalog } from '@humanlayer/schemas/zod/model-catalog'
import { Data, Duration, Effect, Fiber, type ManagedRuntime, Queue, Schedule, Stream } from 'effect'

import { HostMachineStats } from '@/effects/services/host-machine-stats/host-machine-stats.service'
import { BUILD_VERSION } from '@/lib/macros'
import { HostUsageLimits } from '@/lib/usage-limits/host-usage-limits'
import type { ManagedDaemonRuntimeConfig } from '@/managed-daemon-start'
import type { ORPCClient } from '@/orpc/client'
import { shouldRetryORPCRequest } from '@/orpc/retry-policy'

// Keep well under the API's HOST_STALE_AFTER_MS (120s): a host is swept — running
// sessions failed, approvals rejected — after missing 8 consecutive beats.
const HEARTBEAT_INTERVAL = Duration.seconds(15)
// A connection that died while the machine slept never settles; abort the beat so the next one runs.
export const HEARTBEAT_TIMEOUT = Duration.seconds(10)
const REGISTERING_BEAT_RETRY_INTERVAL = Duration.seconds(5)
const REGISTERING_BEAT_RETRIES = 24
// A rate-limit change is pushed after this quiet window so the UI reacts before the regular
// interval, while a burst of events still costs one request.
const USAGE_LIMITS_PUSH_DELAY = Duration.seconds(1)

export interface HeartbeatCapabilities {
	readonly distribution: 'cli' | 'desktop'
	readonly canSelfUpdate: boolean
	readonly ephemeral: boolean
}

export const deriveHeartbeatCapabilities = (
	config: Pick<ManagedDaemonRuntimeConfig, 'automation' | 'selfUpdate'>,
	canSelfUpdate: boolean,
): HeartbeatCapabilities => ({
	distribution: config.selfUpdate === undefined ? 'desktop' : 'cli',
	canSelfUpdate,
	// Startup normalizes omitted automation configuration to null.
	ephemeral: config.automation !== null,
})

export interface HeartbeatUpdate {
	readonly version: string
	readonly state: 'installing' | 'failed'
	readonly error?: string
}

export interface HeartbeatModelCatalogSnapshot {
	/** The host's latest probed model catalog, or undefined before the first probe. */
	readonly current: () => HostModelCatalog | undefined
}

export interface Heartbeat {
	readonly stop: () => void
	/** Sends one beat right away carrying `update`. Rejects when that beat fails; later beats do not repeat it. */
	readonly report: (update: HeartbeatUpdate) => Promise<void>
}

export class HeartbeatError extends Data.TaggedError('HeartbeatError')<{
	readonly hostId: string
	readonly cause: unknown
}> {
	override get message() {
		return `Could not send heartbeat for host ${this.hostId}`
	}
}

interface HeartbeatTarget {
	readonly hostId: string
	readonly orpc: ORPCClient
	readonly capabilities: HeartbeatCapabilities
	readonly updateRequests: Queue.Enqueue<string> | undefined
	readonly modelCatalog: HeartbeatModelCatalogSnapshot | undefined
}

const sendHeartbeat = (target: HeartbeatTarget, update?: HeartbeatUpdate) =>
	Effect.gen(function* () {
		const usageLimits = yield* HostUsageLimits
		const codingAgentUsageLimits = yield* usageLimits.current
		const hostMachineStats = yield* HostMachineStats
		const { machine, stats } = yield* hostMachineStats.current
		const response = yield* Effect.tryPromise({
			try: (signal) =>
				target.orpc.hosts.heartbeat(
					{
						hostId: target.hostId,
						hostName: hostname(),
						daemonVersion: BUILD_VERSION ?? undefined,
						capabilities: [...DAEMON_CAPABILITIES],
						supportedModels: target.modelCatalog?.current(),
						distribution: target.capabilities.distribution,
						canSelfUpdate: target.capabilities.canSelfUpdate,
						ephemeral: target.capabilities.ephemeral,
						update,
						codingAgentUsageLimits,
						machine,
						stats,
					},
					{ signal },
				),
			catch: (cause) => new HeartbeatError({ hostId: target.hostId, cause }),
		}).pipe(
			Effect.timeout(HEARTBEAT_TIMEOUT),
			Effect.catchTag('TimeoutError', (cause) =>
				Effect.fail(new HeartbeatError({ hostId: target.hostId, cause })),
			),
		)
		if (response.updateRequest && target.updateRequests !== undefined) {
			yield* Queue.offer(target.updateRequests, response.updateRequest.version)
		}
	})

const sendHeartbeatLoggingFailure = (target: HeartbeatTarget) =>
	sendHeartbeat(target).pipe(
		Effect.tapError((error) =>
			Effect.logError('Failed to send heartbeat').pipe(Effect.annotateLogs({ hostId: target.hostId, error })),
		),
		Effect.ignore,
	)

/**
 * Start sending heartbeats on the daemon runtime. Sends the first beat before returning, so session
 * dispatch does not begin until the API has registered this host online, then keeps beating on the
 * interval and once more shortly after each usage-limit change. Every version the API asks the
 * daemon to update to is offered to `updateRequests`.
 *
 * Rejects when the registering beat fails for good, so the daemon does not dispatch sessions for an unregistered host.
 */
export async function startHeartbeat(
	runtime: ManagedRuntime.ManagedRuntime<HostUsageLimits | HostMachineStats, unknown>,
	hostId: string,
	orpc: ORPCClient,
	capabilities: HeartbeatCapabilities,
	updateRequests?: Queue.Enqueue<string>,
	modelCatalog?: HeartbeatModelCatalogSnapshot,
): Promise<Heartbeat> {
	const target: HeartbeatTarget = { hostId, orpc, capabilities, updateRequests, modelCatalog }
	await runtime.runPromise(
		sendHeartbeat(target).pipe(
			Effect.tapError((error) =>
				Effect.logWarning('Registering heartbeat failed').pipe(Effect.annotateLogs({ hostId, error })),
			),
			Effect.retry({
				schedule: Schedule.spaced(REGISTERING_BEAT_RETRY_INTERVAL),
				times: REGISTERING_BEAT_RETRIES,
				while: (error) => shouldRetryORPCRequest(error.cause),
			}),
		),
	)

	const beat = sendHeartbeatLoggingFailure(target)
	const onInterval = Effect.sleep(HEARTBEAT_INTERVAL).pipe(Effect.andThen(beat), Effect.forever)
	const onUsageLimitChange = HostUsageLimits.pipe(
		Effect.flatMap((usageLimits) =>
			usageLimits.changes.pipe(
				Stream.debounce(USAGE_LIMITS_PUSH_DELAY),
				Stream.runForEach(() => beat),
			),
		),
	)
	const fiber = runtime.runFork(Effect.all([onInterval, onUsageLimitChange], { concurrency: 'unbounded' }))

	return {
		stop: () => {
			runtime.runFork(Fiber.interrupt(fiber))
		},
		report: (update) => runtime.runPromise(sendHeartbeat(target, update)),
	}
}

export async function sendShutdown(orpc: ORPCClient, hostId: string, reason?: string) {
	return orpc.hosts.shutdown({ hostId, reason })
}
