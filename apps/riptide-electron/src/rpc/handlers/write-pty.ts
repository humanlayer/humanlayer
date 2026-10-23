import * as Effect from 'effect/Effect'

import { PtyService } from '../../pty/pty-service'

export const writePtyHandler = Effect.fn('rpc.write_pty')(function* (payload: {
	readonly ptyId: string
	readonly data: ReadonlyArray<number>
}) {
	const ptyService = yield* PtyService
	return yield* ptyService.write(payload)
})
