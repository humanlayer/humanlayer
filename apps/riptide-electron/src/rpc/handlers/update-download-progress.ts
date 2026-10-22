import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'

import { ElectronUpdaterService } from '../../updater/electron-updater.service'

export const updateDownloadProgressHandler = Effect.fn('rpc.update_download_progress')(function* () {
	const updater = yield* ElectronUpdaterService
	return yield* updater.downloadProgress.pipe(Stream.toQueue({ capacity: 64, strategy: 'sliding' }))
})
