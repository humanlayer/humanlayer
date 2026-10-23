import type { HostMachine, HostStats } from '@humanlayer/db/zodschemas/host-machine-stats'
import { Context, type Effect } from 'effect'

export interface HostMachineStatsSnapshot {
	readonly machine: HostMachine | undefined
	readonly stats: HostStats | undefined
}

/**
 * The newest machine info and load sample, collected on a schedule of its own so reading them
 * never waits on the platform. Each value is validated against the schema the API applies to
 * heartbeats; one that is missing, failed, timed out or invalid is undefined.
 */
export class HostMachineStats extends Context.Service<
	HostMachineStats,
	{
		readonly current: Effect.Effect<HostMachineStatsSnapshot>
	}
>()('HostMachineStats') {}
