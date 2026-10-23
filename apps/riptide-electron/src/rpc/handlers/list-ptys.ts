import * as Effect from 'effect/Effect'

import { PtyService } from '../../pty/pty-service'

export const listPtysHandler = Effect.fn('rpc.list_ptys')(function* () {
	const ptyService = yield* PtyService
	return yield* ptyService.list
})
