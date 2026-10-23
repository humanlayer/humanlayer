import * as Effect from 'effect/Effect'

import { ElectronUpdaterService } from '../../updater/electron-updater.service'

export const downloadUpdateHandler = Effect.fn('rpc.download_update')(function* () {
	const updater = yield* ElectronUpdaterService
	yield* updater.downloadAvailableUpdate()
})
