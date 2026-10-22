import * as Effect from 'effect/Effect'

import { HostLogService } from '../../logging/host-log-service'

export const getLogDirectoryHandler = Effect.fn('rpc.get_log_directory')(function* () {
	const hostLogService = yield* HostLogService
	return yield* hostLogService.getLogDirectory.pipe(
		Effect.annotateSpans({ rpc_operation: 'GetLogDirectory' }),
		Effect.annotateLogs({ rpc_operation: 'GetLogDirectory' }),
	)
})
