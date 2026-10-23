import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Stream from 'effect/Stream'

import { PtyService } from '../src/pty/pty-service'

export const ptyServiceTestLayer = Layer.succeed(
	PtyService,
	PtyService.of({
		create: () => Effect.die('create PTY was not expected'),
		attach: () => Stream.empty,
		detach: () => Effect.void,
		write: () => Effect.void,
		resize: () => Effect.void,
		kill: () => Effect.void,
		list: Effect.succeed([]),
	}),
)
