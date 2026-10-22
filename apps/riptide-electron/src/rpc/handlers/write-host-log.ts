import type { WriteHostLogPayload } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'

import { HostLogService } from '../../logging/host-log-service'

export const writeHostLogHandler = Effect.fn('rpc.write_host_log')(function* (input: WriteHostLogPayload) {
	const hostLogService = yield* HostLogService
	yield* hostLogService
		.writeHostLog(input)
		.pipe(
			Effect.annotateSpans({ rpc_operation: 'WriteHostLog', log_level: input.level }),
			Effect.annotateLogs({ rpc_operation: 'WriteHostLog', log_level: input.level }),
		)
})
