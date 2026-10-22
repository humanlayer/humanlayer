import * as Effect from 'effect/Effect'

import { DaemonSupervisor } from '../../daemon/daemon-supervisor.service'

export const stopDaemonHandler = Effect.fn('rpc.stop_daemon')(function* (input: {
	readonly userId: string
	readonly organizationId: string
}) {
	const daemonSupervisor = yield* DaemonSupervisor
	yield* daemonSupervisor.stop(input)
})
