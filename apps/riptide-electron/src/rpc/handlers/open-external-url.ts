import { ExternalUrlNotAllowedError, ExternalUrlOpenError } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'

import { Sentry } from '../../instrument'
import { ElectronShell } from '../../shell/electron-shell.service'

export const openExternalUrlHandler = Effect.fn('rpc.open_external_url')(function* (input: { readonly url: string }) {
	const parsed = yield* Effect.try({
		try: () => new URL(input.url),
		catch: () => new ExternalUrlNotAllowedError({ message: 'URL must use http or https' }),
	})
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return yield* Effect.fail(new ExternalUrlNotAllowedError({ message: 'URL must use http or https' }))
	}

	const electronShell = yield* ElectronShell
	yield* electronShell.openExternal(input).pipe(
		Effect.tapError((e) => Effect.logError(e)),
		Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
		Effect.mapError((error) => new ExternalUrlOpenError({ message: error.message })),
	)
})
