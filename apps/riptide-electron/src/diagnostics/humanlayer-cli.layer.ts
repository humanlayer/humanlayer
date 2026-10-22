import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'

import { Sentry } from '../instrument'
import { collectChildProcessOutput, loadInteractiveShellEnvironment } from './child-process-output'
import { HumanLayerCli, HumanLayerCliUpdateFailure } from './humanlayer-cli.service'

export const makeHumanLayerCliLive = (options: { readonly updateEnabled: boolean }) =>
	Layer.effect(
		HumanLayerCli,
		Effect.gen(function* () {
			const applicationScope = yield* Effect.scope
			const updateStarted = yield* Ref.make(false)
			const environment = yield* loadInteractiveShellEnvironment().pipe(Effect.cached)

			const updateProgram = environment.pipe(
				Effect.flatMap((loginEnvironment) =>
					collectChildProcessOutput({
						executable: 'npm',
						arguments: ['install', '-g', '@humanlayer/cli@latest'],
						timeout: 30_000,
						environment: loginEnvironment,
						extendEnvironment: false,
					}),
				),
				Effect.flatMap((output) =>
					output.exitCode === 0
						? Effect.void
						: Effect.fail(
								new HumanLayerCliUpdateFailure({
									cause: output.stderr,
									message: `HumanLayer CLI update exited with code ${output.exitCode}`,
								}),
							),
				),
				Effect.catchTag('CliProcessFailure', (error) =>
					Effect.fail(new HumanLayerCliUpdateFailure({ cause: error, message: error.message })),
				),
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTag('HumanLayerCliUpdateFailure', () => Effect.void),
				Effect.withSpan('humanlayer_cli.update.worker'),
			)

			const updateToLatest = Effect.gen(function* () {
				if (!options.updateEnabled) {
					yield* Effect.logDebug('Skipping HumanLayer CLI self-update in local source build')
					return
				}
				const alreadyStarted = yield* Ref.getAndSet(updateStarted, true)
				if (alreadyStarted) return
				yield* Effect.forkIn(updateProgram, applicationScope)
			}).pipe(Effect.withSpan('humanlayer_cli.update_to_latest'))

			return HumanLayerCli.of({ updateToLatest })
		}),
	)
