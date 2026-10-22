import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'

import { PtyService } from '../../pty/pty-service'

export const attachPtyHandler = Effect.fn('rpc.attach_pty')(function* (payload: { readonly ptyId: string }) {
	const ptyService = yield* PtyService
	return yield* ptyService.attach(payload).pipe(Stream.toQueue({ capacity: 256, strategy: 'suspend' }))
})
