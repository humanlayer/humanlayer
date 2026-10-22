import * as Effect from 'effect/Effect'

import { DaemonSupervisor } from '../../daemon/daemon-supervisor.service'

export const isDaemonRunningHandler = Effect.fn('rpc.is_daemon_running')(function* (input: {
	readonly userId: string
	readonly organizationId: string
}) {
	const daemonSupervisor = yield* DaemonSupervisor
	return yield* daemonSupervisor.isRunning(input)
})
