import * as Sentry from '@sentry/node'
import { Crypto, Effect } from 'effect'

import { ProjectPersistenceUnavailable } from './errors'

/** Generate fallback IDs before opening the owning database transaction. */
export const generateProjectWorkspaceId = Effect.fn('project_workspace.generate_id')(function* () {
	const crypto = yield* Crypto.Crypto
	return yield* crypto.randomUUIDv7.pipe(
		Effect.tapError(Effect.logError),
		Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
		Effect.catchTag('PlatformError', () =>
			Effect.fail(new ProjectPersistenceUnavailable({ operation: 'generate_id' })),
		),
	)
})
