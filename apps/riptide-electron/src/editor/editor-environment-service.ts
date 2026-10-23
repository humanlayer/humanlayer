import { EditorEnvironmentError } from '@humanlayer/riptide-electron-rpc'
import * as Config from 'effect/Config'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'

import { Sentry } from '../instrument'

export interface EditorEnvironmentServiceShape {
	readonly get: Effect.Effect<string | null, EditorEnvironmentError>
}

export class EditorEnvironmentService extends Context.Service<
	EditorEnvironmentService,
	EditorEnvironmentServiceShape
>()('EditorEnvironmentService') {}

export const EditorEnvironmentServiceLive = Layer.effect(
	EditorEnvironmentService,
	Effect.gen(function* () {
		// Capture this adapter's provider, not the ambient provider at each RPC call.
		const provider = yield* ConfigProvider.ConfigProvider
		return EditorEnvironmentService.of({
			get: Effect.gen(function* () {
				const editor = yield* Config.option(Config.String('EDITOR')).parse(provider)
				if (Option.isSome(editor)) return editor.value
				return Option.getOrNull(yield* Config.option(Config.String('VISUAL')).parse(provider))
			}).pipe(
				Effect.tapError((error) =>
					Effect.logError('Editor environment configuration failed', error).pipe(
						Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
					),
				),
				Effect.mapError(() => new EditorEnvironmentError({ message: 'Failed to read editor environment' })),
				Effect.withSpan('editor_environment.get'),
			),
		})
	}),
)
