import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'

import { DaemonSupervisor } from '../../daemon/daemon-supervisor.service'

export const daemonLifecycleEventsHandler = Effect.fn('rpc.daemon_lifecycle_events')(function* () {
	const daemonSupervisor = yield* DaemonSupervisor
	return yield* daemonSupervisor.lifecycleEvents.pipe(Stream.toQueue({ capacity: 64, strategy: 'sliding' }))
})
