// A lane that repeats one step until the session unbinds: the heartbeat and the inbox. Daemon
// tokens re-mint inside the step (withDaemonToken); this only paces steps and handles failures.

import { log } from './config.ts'
import type { LaneHost, Participant } from './lane.ts'
import { classifyRpcError, type RpcErrorAction } from './rpc.ts'
import { errorMessage, sleepUnref } from './util.ts'

export interface LoopSpec {
	/** Names the loop in the log. */
	name: string
	/** One step. The signal aborts when the lane closes. */
	step(signal: AbortSignal): Promise<void>
	/** How long to wait before the next step, after `failures` failures in a row (0 after a success). */
	pauseMs(failures: number): number
	/** Failures that end the loop for good. */
	stopOn: readonly RpcErrorAction['kind'][]
	/** Called after each failed step, with the count in a row. */
	onFailure?(failures: number): void
}

export function loopLane(host: LaneHost, spec: LoopSpec): Participant {
	const stop = new AbortController()
	const signal = AbortSignal.any([host.signal, stop.signal])
	void run(spec, signal)
	return { close: () => stop.abort() }
}

async function run(spec: LoopSpec, signal: AbortSignal): Promise<void> {
	let failures = 0
	while (!signal.aborted) {
		try {
			await spec.step(signal)
			failures = 0
		} catch (err) {
			if (signal.aborted) return
			if (spec.stopOn.includes(classifyRpcError(err, 'daemon').kind)) {
				log(`${spec.name} stopped: ${errorMessage(err)}`)
				return
			}
			// One line per run of failures, not one per step.
			if (failures === 0) log(`${spec.name}: ${errorMessage(err)}`)
			spec.onFailure?.(++failures)
		}
		const ms = spec.pauseMs(failures)
		if (ms > 0) await sleepUnref(ms, signal)
	}
}
