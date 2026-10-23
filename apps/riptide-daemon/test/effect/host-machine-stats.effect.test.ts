import * as BunServices from '@effect/platform-bun/BunServices'
import { describe, expect, it } from '@effect/vitest'
import type { HostMachine, HostStats } from '@humanlayer/db/zodschemas/host-machine-stats'
import { ConfigProvider, Effect, Layer, Logger, Ref } from 'effect'
import { TestClock } from 'effect/testing'

import {
	HostMachineProbe,
	type ReadHostLoadInput,
} from '@/effects/services/host-machine-stats/host-machine-probe.service'
import {
	HostLoadReadError,
	type MachineInfoReadError,
} from '@/effects/services/host-machine-stats/host-machine-stats.errors'
import {
	HOST_MACHINE_COLLECTION_TIMEOUT,
	HOST_MACHINE_SAMPLE_INTERVAL,
	HostMachineStatsLive,
} from '@/effects/services/host-machine-stats/host-machine-stats.layer'
import { HostMachineStats } from '@/effects/services/host-machine-stats/host-machine-stats.service'
import { ActiveSessions } from '@/effects/services/session-runs/active-sessions'

const machine: HostMachine = {
	os: 'Ubuntu 26.04 LTS',
	arch: 'x64',
	cpuModel: 'AMD Ryzen 7 9700X',
	cpuCores: 10,
	memTotalBytes: 32_000_000_000,
	uptimeSec: 100,
}

const hostLoad = ({ runningSessionCount }: ReadHostLoadInput, cpuPct: number): HostStats => ({
	capturedAt: 1_000,
	cpuPct,
	memUsedBytes: 16_000_000_000,
	memTotalBytes: 32_000_000_000,
	sessionCount: runningSessionCount,
})

type ReadHostLoad = (input: ReadHostLoadInput) => Effect.Effect<HostStats, HostLoadReadError>

interface ScriptedProbe {
	readonly readMachineInfo: Ref.Ref<Effect.Effect<HostMachine, MachineInfoReadError>>
	readonly readHostLoad: Ref.Ref<ReadHostLoad>
	readonly hostLoadReads: Ref.Ref<number>
}

const makeScriptedProbe = (readHostLoad: ReadHostLoad) =>
	Effect.gen(function* () {
		const script: ScriptedProbe = {
			readMachineInfo: yield* Ref.make<Effect.Effect<HostMachine, MachineInfoReadError>>(Effect.succeed(machine)),
			readHostLoad: yield* Ref.make(readHostLoad),
			hostLoadReads: yield* Ref.make(0),
		}
		const layer = Layer.succeed(
			HostMachineProbe,
			HostMachineProbe.of({
				readMachineInfo: Effect.flatten(Ref.get(script.readMachineInfo)),
				readHostLoad: (input) =>
					Ref.update(script.hostLoadReads, (reads) => reads + 1).pipe(
						Effect.andThen(Ref.get(script.readHostLoad)),
						Effect.flatMap((read) => read(input)),
					),
			}),
		)
		return { script, layer }
	})

const hostMachineStatsLayer = (
	probe: Layer.Layer<HostMachineProbe>,
	config: Record<string, string> = {},
	activeSessionIds: Effect.Effect<ReadonlyArray<string>> = Effect.succeed([]),
) =>
	HostMachineStatsLive.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				probe,
				Layer.succeed(ActiveSessions, ActiveSessions.of({ ids: activeSessionIds })),
				BunServices.layer,
				Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(config)),
			),
		),
	)

const letSamplerRun = TestClock.adjust('1 millis')

describe('HostMachineStats', () => {
	it.effect('publishes a validated sample at startup and replaces it every 15 seconds', () =>
		Effect.gen(function* () {
			const cpuReadings = yield* Ref.make(0)
			const { layer } = yield* makeScriptedProbe((input) =>
				Ref.updateAndGet(cpuReadings, (reading) => reading + 10).pipe(
					Effect.map((cpuPct) => hostLoad(input, cpuPct)),
				),
			)

			yield* Effect.gen(function* () {
				const stats = yield* HostMachineStats
				yield* letSamplerRun
				expect(yield* stats.current).toEqual({
					machine,
					stats: { ...hostLoad({ runningSessionCount: 0 }, 10), activeSessionIds: [] },
				})

				yield* TestClock.adjust(HOST_MACHINE_SAMPLE_INTERVAL)
				expect((yield* stats.current).stats?.cpuPct).toBe(20)
			}).pipe(Effect.provide(hostMachineStatsLayer(layer)))
		}),
	)

	it.effect('reports the active sessions at each sample, listing up to 100 ids', () =>
		Effect.gen(function* () {
			const { layer } = yield* makeScriptedProbe((input) => Effect.succeed(hostLoad(input, 5)))
			const activeSessions = yield* Ref.make<ReadonlyArray<string>>([])

			yield* Effect.gen(function* () {
				const stats = yield* HostMachineStats
				yield* letSamplerRun
				expect((yield* stats.current).stats).toMatchObject({ sessionCount: 0, activeSessionIds: [] })

				yield* Ref.set(activeSessions, ['session-1', 'session-2'])
				yield* TestClock.adjust(HOST_MACHINE_SAMPLE_INTERVAL)
				expect((yield* stats.current).stats).toMatchObject({
					sessionCount: 2,
					activeSessionIds: ['session-1', 'session-2'],
				})

				const manySessions = Array.from({ length: 120 }, (_, index) => `session-${index}`)
				yield* Ref.set(activeSessions, manySessions)
				yield* TestClock.adjust(HOST_MACHINE_SAMPLE_INTERVAL)
				expect((yield* stats.current).stats).toMatchObject({
					sessionCount: 120,
					activeSessionIds: manySessions.slice(0, 100),
				})
			}).pipe(Effect.provide(hostMachineStatsLayer(layer, {}, Ref.get(activeSessions))))
		}),
	)

	it.effect('drops a sample the heartbeat schema would reject and keeps the valid one', () =>
		Effect.gen(function* () {
			const { layer } = yield* makeScriptedProbe((input) => Effect.succeed(hostLoad(input, 250)))

			yield* Effect.gen(function* () {
				const stats = yield* HostMachineStats
				yield* letSamplerRun
				expect(yield* stats.current).toEqual({ machine, stats: undefined })
			}).pipe(Effect.provide(hostMachineStatsLayer(layer)))
		}),
	)

	it.effect('gives up on a collection that never settles after the timeout', () =>
		Effect.gen(function* () {
			const { layer } = yield* makeScriptedProbe(() => Effect.never)

			yield* Effect.gen(function* () {
				const stats = yield* HostMachineStats
				yield* letSamplerRun
				yield* TestClock.adjust(HOST_MACHINE_COLLECTION_TIMEOUT)
				expect(yield* stats.current).toEqual({ machine, stats: undefined })
			}).pipe(Effect.provide(hostMachineStatsLayer(layer)))
		}),
	)

	it.effect('logs the first failure of an outage and the recovery, not every sample between', () =>
		Effect.gen(function* () {
			const logs: string[] = []
			const failingRead: ReadHostLoad = () =>
				Effect.fail(new HostLoadReadError({ cause: new Error('mem() failed') }))
			const { script, layer } = yield* makeScriptedProbe(failingRead)

			yield* Effect.gen(function* () {
				const stats = yield* HostMachineStats
				yield* letSamplerRun
				yield* TestClock.adjust(HOST_MACHINE_SAMPLE_INTERVAL)
				yield* TestClock.adjust(HOST_MACHINE_SAMPLE_INTERVAL)
				expect(yield* Ref.get(script.hostLoadReads)).toBe(3)
				expect(logs).toEqual(['Could not collect machine stats; heartbeats continue without it'])

				yield* Ref.set(script.readHostLoad, (input) => Effect.succeed(hostLoad(input, 30)))
				yield* TestClock.adjust(HOST_MACHINE_SAMPLE_INTERVAL)
				expect(logs).toEqual([
					'Could not collect machine stats; heartbeats continue without it',
					'Collecting machine stats again',
				])
				expect((yield* stats.current).stats?.cpuPct).toBe(30)
			}).pipe(
				Effect.provide(hostMachineStatsLayer(layer)),
				Effect.provide(
					Logger.layer([
						Logger.make(({ message }) => {
							logs.push(Array.isArray(message) ? message.join(' ') : String(message))
						}),
					]),
				),
			)
		}),
	)

	it.effect('collects nothing when RIPTIDE_DAEMON_MACHINE_STATS is off', () =>
		Effect.gen(function* () {
			const { script, layer } = yield* makeScriptedProbe((input) => Effect.succeed(hostLoad(input, 5)))

			yield* Effect.gen(function* () {
				const stats = yield* HostMachineStats
				yield* TestClock.adjust(HOST_MACHINE_SAMPLE_INTERVAL)
				expect(yield* stats.current).toEqual({ machine: undefined, stats: undefined })
				expect(yield* Ref.get(script.hostLoadReads)).toBe(0)
			}).pipe(Effect.provide(hostMachineStatsLayer(layer, { RIPTIDE_DAEMON_MACHINE_STATS: 'off' })))
		}),
	)
})
