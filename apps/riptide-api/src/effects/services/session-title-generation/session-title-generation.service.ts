import { Context, Effect, Layer } from 'effect'

import {
	runSessionTitleGenerationAsync,
	type SessionTitleGenerationParams,
} from '../../../lib/session-title-generation'
import { PostgresDb } from '../postgres/postgres-db.service'

export type GenerateSessionTitleInput = SessionTitleGenerationParams

export class SessionTitleGeneration extends Context.Service<
	SessionTitleGeneration,
	{
		readonly scheduleGeneration: (input: GenerateSessionTitleInput) => Effect.Effect<void>
	}
>()('SessionTitleGeneration') {}

export const SessionTitleGenerationLive = Layer.effect(
	SessionTitleGeneration,
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const scope = yield* Effect.scope

		const scheduleGeneration = (input: GenerateSessionTitleInput) =>
			Effect.promise(() => runSessionTitleGenerationAsync(postgres.client, input)).pipe(
				Effect.forkIn(scope),
				Effect.asVoid,
			)

		return SessionTitleGeneration.of({ scheduleGeneration })
	}),
)
