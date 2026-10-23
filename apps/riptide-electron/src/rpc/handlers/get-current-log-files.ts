import { HostLogAccessError } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'

import { HostLogService } from '../../logging/host-log-service'

export const getCurrentLogFilesHandler = Effect.fn('rpc.get_current_log_files')(function* () {
	const hostLogService = yield* HostLogService
	return yield* hostLogService.getCurrentLogFiles.pipe(
		Effect.mapError((error) => new HostLogAccessError({ message: error.message })),
		Effect.annotateSpans({ rpc_operation: 'GetCurrentLogFiles' }),
		Effect.annotateLogs({ rpc_operation: 'GetCurrentLogFiles' }),
	)
})
