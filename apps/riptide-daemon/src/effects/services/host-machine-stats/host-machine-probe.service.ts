import type { HostMachine, HostStats } from '@humanlayer/db/zodschemas/host-machine-stats'
import { Context, type Effect } from 'effect'
import type { ChildProcessSpawner } from 'effect/process'

import type { HostLoadReadError, MachineInfoReadError } from './host-machine-stats.errors'

export interface ReadHostLoadInput {
	readonly runningSessionCount: number
}

/**
 * Reads the machine the daemon runs on. Cpu figures are deltas since the previous read, so one
 * probe lives as long as the daemon. The process table is best effort: when it cannot be read, the
 * load still arrives without the process-tree memory and top processes.
 */
export class HostMachineProbe extends Context.Service<
	HostMachineProbe,
	{
		readonly readMachineInfo: Effect.Effect<HostMachine, MachineInfoReadError>
		readonly readHostLoad: (
			input: ReadHostLoadInput,
		) => Effect.Effect<HostStats, HostLoadReadError, ChildProcessSpawner.ChildProcessSpawner>
	}
>()('HostMachineProbe') {}
