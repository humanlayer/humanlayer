import * as Effect from 'effect/Effect'

import { PtyService } from '../../pty/pty-service'

export const resizePtyHandler = Effect.fn('rpc.resize_pty')(function* (payload: {
	readonly ptyId: string
	readonly cols: number
	readonly rows: number
}) {
	const ptyService = yield* PtyService
	return yield* ptyService.resize(payload)
})
