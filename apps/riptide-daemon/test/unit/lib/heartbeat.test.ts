import { it } from '@effect/vitest'
import { heartbeatInputSchema } from '@humanlayer/riptide-api-contract/daemon/heartbeat'
import { createORPCClient } from '@orpc/client'
import { Duration, Effect, Layer, ManagedRuntime, Queue } from 'effect'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type {
	HostMachineStats,
	HostMachineStatsSnapshot,
} from '../../../src/effects/services/host-machine-stats/host-machine-stats.service'
import { HEARTBEAT_TIMEOUT, HeartbeatError, startHeartbeat } from '../../../src/lib/heartbeat'
import { type HostUsageLimits, HostUsageLimitsLive } from '../../../src/lib/usage-limits/host-usage-limits'
import type { ORPCClient } from '../../../src/orpc/client'
import { EMPTY_HOST_MACHINE_STATS, makeHostMachineStatsTestLayer } from '../../helpers/host-machine-stats'

type HeartbeatProcedure = ORPCClient['hosts']['heartbeat']
type HeartbeatMock = ReturnType<
	typeof vi.fn<
		(
			input: Parameters<HeartbeatProcedure>[0],
			options?: Parameters<HeartbeatProcedure>[1],
		) => ReturnType<HeartbeatProcedure>
	>
>

const capabilities = { distribution: 'cli', canSelfUpdate: true, ephemeral: false } as const

const heartbeatMock = (): HeartbeatMock => vi.fn(async () => ({ updateRequest: null }))

const heartbeatTimeoutMs = Duration.toMillis(HEARTBEAT_TIMEOUT)

const neverSettles = (signals: AbortSignal[]) => (_input: unknown, options?: { signal?: AbortSignal }) => {
	if (options?.signal) signals.push(options.signal)
	return new Promise<never>(() => {})
}

const makeOrpc = (heartbeat: HeartbeatMock) => ({ hosts: { heartbeat, shutdown: vi.fn() } }) as unknown as ORPCClient

describe('startHeartbeat', () => {
	let runtime: ManagedRuntime.ManagedRuntime<HostUsageLimits | HostMachineStats, never>

	beforeEach(() => {
		vi.useFakeTimers()
		runtime = ManagedRuntime.make(Layer.mergeAll(HostUsageLimitsLive, makeHostMachineStatsTestLayer()))
	})

	afterEach(async () => {
		await runtime.dispose()
		vi.useRealTimers()
	})

	test('sends a reported update once, not on later beats', async () => {
		const heartbeat = heartbeatMock()
		const running = await startHeartbeat(runtime, 'host-1', makeOrpc(heartbeat), capabilities)

		await running.report({ version: '0.32.0', state: 'failed', error: 'boom' })
		await vi.advanceTimersByTimeAsync(15_000)
		running.stop()

		expect(heartbeat).toHaveBeenCalledTimes(3)
		expect(heartbeat.mock.calls[1]?.[0]).toMatchObject({
			distribution: 'cli',
			canSelfUpdate: true,
			update: { version: '0.32.0', state: 'failed', error: 'boom' },
		})
		expect(heartbeat.mock.calls[2]?.[0]).toMatchObject({ distribution: 'cli', ephemeral: false, update: undefined })
	})

	test('rejects a report whose beat fails', async () => {
		const heartbeat = heartbeatMock()
			.mockResolvedValueOnce({ updateRequest: null })
			.mockRejectedValueOnce(new Error('network'))
		const running = await startHeartbeat(runtime, 'host-1', makeOrpc(heartbeat), capabilities)

		const failure = running.report({ version: '0.32.0', state: 'installing' })
		await expect(failure).rejects.toBeInstanceOf(HeartbeatError)
		await expect(failure).rejects.toMatchObject({ cause: new Error('network') })
		running.stop()
	})

	test('attaches the newest host machine stats to every beat', async () => {
		const heartbeat = heartbeatMock()
		const machine = {
			os: 'Ubuntu 26.04 LTS',
			arch: 'x64',
			cpuModel: 'AMD EPYC 7763',
			cpuCores: 8,
			memTotalBytes: 34_359_738_368,
			uptimeSec: 60,
		}
		const stats = { capturedAt: 1_000, cpuPct: 40, memUsedBytes: 1, memTotalBytes: 2, sessionCount: 3 }
		let snapshot: HostMachineStatsSnapshot = EMPTY_HOST_MACHINE_STATS
		const statsRuntime = ManagedRuntime.make(
			Layer.mergeAll(
				HostUsageLimitsLive,
				makeHostMachineStatsTestLayer(() => snapshot),
			),
		)
		const running = await startHeartbeat(statsRuntime, 'host-1', makeOrpc(heartbeat), capabilities)
		snapshot = { machine, stats }
		await vi.advanceTimersByTimeAsync(15_000)
		running.stop()
		await statsRuntime.dispose()

		expect(heartbeat.mock.calls[0]?.[0]).toMatchObject({ machine: undefined, stats: undefined })
		expect(heartbeat.mock.calls[1]?.[0]).toMatchObject({ machine, stats })
	})

	test('offers every requested version to the update request queue', async () => {
		const heartbeat = heartbeatMock().mockResolvedValue({ updateRequest: { version: '0.33.0' } })
		const updateRequests = Effect.runSync(Queue.unbounded<string>())
		const running = await startHeartbeat(runtime, 'host-1', makeOrpc(heartbeat), capabilities, updateRequests)
		await vi.advanceTimersByTimeAsync(15_000)
		running.stop()

		expect(Effect.runSync(Queue.takeAll(updateRequests))).toEqual(['0.33.0', '0.33.0'])
	})

	test('aborts a beat that never settles and still sends the next one', async () => {
		const signals: AbortSignal[] = []
		const heartbeat = heartbeatMock()
			.mockResolvedValueOnce({ updateRequest: null })
			.mockImplementationOnce(neverSettles(signals))
		const running = await startHeartbeat(runtime, 'host-1', makeOrpc(heartbeat), capabilities)

		await vi.advanceTimersByTimeAsync(15_000)
		expect(heartbeat).toHaveBeenCalledTimes(2)
		expect(signals[0]?.aborted).toBe(false)

		await vi.advanceTimersByTimeAsync(heartbeatTimeoutMs)
		expect(signals[0]?.aborted).toBe(true)

		await vi.advanceTimersByTimeAsync(16_000)
		running.stop()

		expect(heartbeat).toHaveBeenCalledTimes(3)
	})

	test('retries a registering beat that never settles until one lands', async () => {
		const signals: AbortSignal[] = []
		const heartbeat = heartbeatMock().mockImplementationOnce(neverSettles(signals))

		const startup = startHeartbeat(runtime, 'host-1', makeOrpc(heartbeat), capabilities)
		await vi.advanceTimersByTimeAsync(heartbeatTimeoutMs)
		expect(signals[0]?.aborted).toBe(true)
		expect(heartbeat).toHaveBeenCalledTimes(1)

		await vi.advanceTimersByTimeAsync(5_000)
		const running = await startup
		running.stop()

		expect(heartbeat).toHaveBeenCalledTimes(2)
	})

	test('rejects a registering beat the API refuses without retrying', async () => {
		const refusal = Object.assign(new Error('host not found'), { status: 404 })
		const heartbeat = heartbeatMock().mockRejectedValueOnce(refusal)

		const error = await startHeartbeat(runtime, 'host-1', makeOrpc(heartbeat), capabilities).catch(
			(cause: unknown) => cause,
		)

		expect(error).toBeInstanceOf(HeartbeatError)
		expect(heartbeat).toHaveBeenCalledTimes(1)
	})
})

describe('heartbeat registration lifetime payload', () => {
	for (const ephemeral of [true, false]) {
		it.effect(`sends ephemeral=${ephemeral} on registering and update-report beats`, () =>
			Effect.gen(function* () {
				const runtime = yield* Effect.acquireRelease(
					Effect.sync(() =>
						ManagedRuntime.make(Layer.mergeAll(HostUsageLimitsLive, makeHostMachineStatsTestLayer())),
					),
					(runtime) => Effect.promise(() => runtime.dispose()),
				)
				const requests: Array<ReturnType<typeof heartbeatInputSchema.parse>> = []
				const orpc = createORPCClient<ORPCClient>({
					call: async (path, input) => {
						expect(path).toEqual(['hosts', 'heartbeat'])
						requests.push(heartbeatInputSchema.parse(input))
						return { updateRequest: null }
					},
				})
				const heartbeat = yield* Effect.acquireRelease(
					Effect.promise(() => startHeartbeat(runtime, 'host-1', orpc, { ...capabilities, ephemeral })),
					(heartbeat) => Effect.sync(() => heartbeat.stop()),
				)
				yield* Effect.promise(() => heartbeat.report({ version: '0.32.0', state: 'installing' }))
				expect(requests).toHaveLength(2)
				for (const request of requests) {
					expect(request).toMatchObject({
						hostId: 'host-1',
						ephemeral,
						distribution: 'cli',
						canSelfUpdate: true,
					})
				}
			}).pipe(Effect.scoped),
		)
	}
})
