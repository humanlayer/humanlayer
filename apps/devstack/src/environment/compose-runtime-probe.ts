import { Context, Data, Effect, Layer } from 'effect'

import { createComposeStatusCommand } from '../lib/compose'
import { createDockerProcessEnvironment } from '../lib/docker-config'
import type { StackRecord } from '../lib/registry'
import { ProcessRunner } from './process-runner'

export class ComposeRuntimeProbeError extends Data.TaggedError('ComposeRuntimeProbeError')<{
	readonly reason: string
	readonly cause?: unknown
}> {}

export interface ComposeRuntimeProbeShape {
	readonly isRunning: (input: {
		readonly stack: StackRecord
		readonly registryPath: string
		readonly initializeDockerConfig?: boolean
	}) => Effect.Effect<boolean, ComposeRuntimeProbeError>
}

export class ComposeRuntimeProbe extends Context.Service<ComposeRuntimeProbe, ComposeRuntimeProbeShape>()(
	'devstack/ComposeRuntimeProbe',
) {}

export const ComposeRuntimeProbeLive = Layer.effect(
	ComposeRuntimeProbe,
	Effect.gen(function* () {
		const processRunner = yield* ProcessRunner
		return {
			isRunning: ({ stack, registryPath, initializeDockerConfig = true }) => {
				const attributes = { stackId: stack.id, composeProject: stack.composeProject }
				return Effect.gen(function* () {
					const command = createComposeStatusCommand(stack)
					const environment = yield* Effect.tryPromise({
						try: () =>
							createDockerProcessEnvironment({ registryPath, initializeConfig: initializeDockerConfig }),
						catch: (cause) =>
							new ComposeRuntimeProbeError({
								reason: 'Unable to prepare the devstack Docker configuration',
								cause,
							}),
					})
					const output = yield* processRunner.run({ ...command, env: environment })
					return output.stdout.split('\n').some((service) => service.trim() === 'postgres')
				}).pipe(
					Effect.tapError((error) =>
						Effect.logError('Compose runtime probe failed', error).pipe(Effect.annotateLogs(attributes)),
					),
					Effect.catchTag('ProcessRunnerError', (error) =>
						Effect.fail(
							new ComposeRuntimeProbeError({ reason: 'Unable to inspect Compose runtime', cause: error }),
						),
					),
					Effect.withSpan('devstack.compose_runtime.is_running', { attributes }),
				)
			},
		} satisfies ComposeRuntimeProbeShape
	}),
)
