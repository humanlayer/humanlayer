import { Effect, Layer } from 'effect'

import {
	HostMachineStats,
	type HostMachineStatsSnapshot,
} from '../../src/effects/services/host-machine-stats/host-machine-stats.service'

export const EMPTY_HOST_MACHINE_STATS: HostMachineStatsSnapshot = { machine: undefined, stats: undefined }

/** Serves whatever `readSnapshot` returns at the moment the snapshot is read. */
export const makeHostMachineStatsTestLayer = (
	readSnapshot: () => HostMachineStatsSnapshot = () => EMPTY_HOST_MACHINE_STATS,
) => Layer.succeed(HostMachineStats, HostMachineStats.of({ current: Effect.sync(readSnapshot) }))
