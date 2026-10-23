import * as Effect from 'effect/Effect'

import { ElectronUpdaterService } from '../../updater/electron-updater.service'

export const checkForUpdateHandler = Effect.fn('rpc.check_for_update')(function* () {
	const updater = yield* ElectronUpdaterService
	// The CheckForUpdate RPC has no error type -- return null on failure.
	return yield* updater.checkForAppUpdate().pipe(Effect.catch(() => Effect.succeed(null)))
})
