import * as Effect from 'effect/Effect'

import { PtyService } from '../../pty/pty-service'

export const detachPtyHandler = Effect.fn('rpc.detach_pty')(function* (payload: { readonly ptyId: string }) {
	const ptyService = yield* PtyService
	return yield* ptyService.detach(payload)
})
