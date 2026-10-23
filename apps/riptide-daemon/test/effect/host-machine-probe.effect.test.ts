import * as BunServices from '@effect/platform-bun/BunServices'
import { describe, expect, it } from '@effect/vitest'
import { HostMachineSchema, HostStatsSchema } from '@humanlayer/db/zodschemas/host-machine-stats'
import { Effect, Layer } from 'effect'

import { HostMachineProbeLive } from '@/effects/services/host-machine-stats/host-machine-probe.layer'
import { HostMachineProbe } from '@/effects/services/host-machine-stats/host-machine-probe.service'

const probeLayer = HostMachineProbeLive.pipe(Layer.provideMerge(BunServices.layer))

describe('HostMachineProbeLive on this host', () => {
	it.live('reads machine info the heartbeat schema accepts', () =>
		Effect.gen(function* () {
			const probe = yield* HostMachineProbe
			const machine = HostMachineSchema.parse(yield* probe.readMachineInfo)

			expect(machine.cpuCores).toBeGreaterThan(0)
			expect(machine.memTotalBytes).toBeGreaterThan(0)
		}).pipe(Effect.provide(probeLayer)),
	)

	it.live('reads host load with the daemon tree memory and, from the second read, top processes', () =>
		Effect.gen(function* () {
			const probe = yield* HostMachineProbe
			const first = HostStatsSchema.parse(yield* probe.readHostLoad({ runningSessionCount: 2 }))
			const second = HostStatsSchema.parse(yield* probe.readHostLoad({ runningSessionCount: 2 }))

			for (const sample of [first, second]) {
				expect(sample.cpuPct).toBeGreaterThanOrEqual(0)
				expect(sample.cpuPct).toBeLessThanOrEqual(100)
				expect(sample.sessionCount).toBe(2)
			}
			if (process.platform !== 'win32') {
				expect(second.memDaemonTreeBytes).toBeGreaterThan(0)
				expect(first.topProcesses).toBeUndefined()
				expect(second.topProcesses?.length).toBeGreaterThan(0)
			}
		}).pipe(Effect.provide(probeLayer)),
	)
})
