import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { dialog } from 'electron'

import { Sentry } from '../instrument'
import { DirectoryPicker, DirectoryPickerFailure } from './directory-picker.service'

const pickDirectory = Effect.tryPromise({
	try: () => dialog.showOpenDialog({ properties: ['openDirectory'] }),
	catch: (cause) => new DirectoryPickerFailure({ cause }),
}).pipe(
	Effect.map((result) => (result.canceled ? null : (result.filePaths[0] ?? null))),
	Effect.tapError((error) => Effect.logError('Could not open the Electron directory picker', error)),
	Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
	Effect.withSpan('directory_picker.pick_directory'),
)

export const DirectoryPickerLive = Layer.succeed(DirectoryPicker, DirectoryPicker.of({ pickDirectory }))
