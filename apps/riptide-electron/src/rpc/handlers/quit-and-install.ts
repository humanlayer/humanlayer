import * as Effect from 'effect/Effect'

import { ElectronUpdaterService } from '../../updater/electron-updater.service'

export const quitAndInstallHandler = Effect.fn('rpc.quit_and_install')(function* () {
	const updater = yield* ElectronUpdaterService
	return yield* updater.quitAndInstallUpdate()
})
