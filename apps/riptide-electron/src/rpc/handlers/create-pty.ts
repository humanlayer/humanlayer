import * as Effect from 'effect/Effect'

import { PtyService } from '../../pty/pty-service'

export const createPtyHandler = Effect.fn('rpc.create_pty')(function* (payload: { readonly cwd: string }) {
	const ptyService = yield* PtyService
	return yield* ptyService.create(payload)
})
