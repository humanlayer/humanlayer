// The host heartbeat (plan-part-2.md phase 3). The web app shows a session's host as offline, and
// turns its composer off, unless the host beats as riptide-daemon does. This lane beats while a
// session is bound. It never calls hosts/shutdown: that fails every active session on the host,
// and all pi processes on this machine share one host id. The stale-daemon sweeper marks the
// host offline about two minutes after the last beat.

import { hostname } from 'node:os'

import { daemonCall } from './api.ts'
import { heartbeatMs } from './config.ts'
import type { LaneHost, Participant } from './lane.ts'
import { loopLane } from './loop.ts'

/** Beats in a row that fail before the user hears the web app shows the host offline. */
const WARN_AFTER = 3

export function heartbeatLane(host: LaneHost): Participant {
	const { channel, hostId } = host.binding
	const everyMs = heartbeatMs()
	const beat = {
		hostId,
		hostName: hostname(),
		// This host only runs sessions a user started on it, so the web app offers no launches there.
		capabilities: ['attachedSessionsOnly', 'agent:pi'],
		canSelfUpdate: false,
	}
	return loopLane(host, {
		name: 'heartbeat',
		step: async (signal) => {
			await daemonCall(channel, 'hosts/heartbeat', beat, signal)
		},
		pauseMs: () => everyMs,
		stopOn: ['stop-all', 'stop-binding'],
		onFailure: (failures) => {
			if (failures === WARN_AFTER)
				host.warn(
					'heartbeat',
					'HumanLayer: could not reach the cloud, so the web app shows this host as offline',
				)
		},
	})
}
