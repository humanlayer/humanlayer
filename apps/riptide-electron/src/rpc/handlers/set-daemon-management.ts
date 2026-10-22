import * as Effect from 'effect/Effect'

import { DaemonSupervisor } from '../../daemon/daemon-supervisor.service'

export const setDaemonManagementHandler = Effect.fn('rpc.set_daemon_management')(function* (input: {
	readonly enabled: boolean
}) {
	const daemonSupervisor = yield* DaemonSupervisor
	yield* daemonSupervisor.setManagementEnabled(input.enabled)
})
