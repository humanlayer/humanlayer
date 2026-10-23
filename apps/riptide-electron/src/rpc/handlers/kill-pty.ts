import * as Effect from 'effect/Effect'

import { PtyService } from '../../pty/pty-service'

export const killPtyHandler = Effect.fn('rpc.kill_pty')(function* (payload: { readonly ptyId: string }) {
	const ptyService = yield* PtyService
	return yield* ptyService.kill(payload)
})
