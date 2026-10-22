import { DirectoryPickerOperationError } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'

import { DirectoryPicker } from '../../directory-picker/directory-picker.service'

export const pickDirectoryHandler = Effect.fn('rpc.pick_directory')(function* () {
	return yield* (yield* DirectoryPicker).pickDirectory.pipe(
		Effect.mapError(() => new DirectoryPickerOperationError({ message: 'Could not open the directory picker' })),
		Effect.annotateSpans({ rpc_operation: 'PickDirectory' }),
		Effect.annotateLogs({ rpc_operation: 'PickDirectory' }),
	)
})
