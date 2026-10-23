import * as Effect from 'effect/Effect'

import { HostIdService } from '../../host/host-id-service'

const annotations = { rpc_operation: 'GetHostId' }

export const getHostIdHandler = Effect.fn('rpc.get_host_id')(function* () {
	const hostIdService = yield* HostIdService
	return yield* hostIdService.get.pipe(Effect.annotateSpans(annotations), Effect.annotateLogs(annotations))
})
