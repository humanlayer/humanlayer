import type { UpdateEvent, UpdateInfo } from '@humanlayer/riptide-electron-rpc'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as Stream from 'effect/Stream'

import type {
	UpdateCheckError,
	UpdateDownloadError,
	UpdateNotAvailableError,
	UpdateNotReadyError,
} from './electron-updater.errors'

export interface ElectronUpdaterServiceShape {
	readonly checkForAppUpdate: () => Effect.Effect<UpdateInfo | null, UpdateCheckError>
	readonly downloadAvailableUpdate: () => Effect.Effect<void, UpdateNotAvailableError | UpdateDownloadError>
	readonly downloadProgress: Stream.Stream<UpdateEvent>
	readonly quitAndInstallUpdate: () => Effect.Effect<never, UpdateNotReadyError>
}

export class ElectronUpdaterService extends Context.Service<ElectronUpdaterService, ElectronUpdaterServiceShape>()(
	'ElectronUpdaterService',
) {}
