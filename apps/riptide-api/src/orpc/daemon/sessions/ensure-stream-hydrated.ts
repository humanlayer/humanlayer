import { Effect } from 'effect'

import { DurableStreamSessionService } from '../../../effects/services/durable-streams/streams'
import { Sentry } from '../../../instrument'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

/**
 * Ensure a durable stream exists and is hydrated for a session.
 * The daemon should call this before creating a StreamProducer to avoid
 * hangs when the stream doesn't exist or needs hydration.
 */
export const ensureStreamHydratedProcedure = effectOrpcDaemonBase.sessions.ensureStreamHydrated
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const durableStreams = yield* DurableStreamSessionService
		const auth = {
			organizationId: context.auth.organizationId,
			userId: context.auth.userId,
		}
		yield* Effect.annotateCurrentSpan({
			session_id: input.sessionId,
			organization_id: auth.organizationId,
			user_id: auth.userId,
		})

		const result = yield* durableStreams.getOrHydrateSession({ sessionId: input.sessionId, auth }).pipe(
			Effect.withSpan('durable_streams.ensure_stream_hydrated', {
				attributes: {
					session_id: input.sessionId,
					organization_id: auth.organizationId,
					user_id: auth.userId,
				},
			}),
			Effect.tapError((error) =>
				Effect.sync(() => {
					Sentry.captureException(error, {
						tags: { error_type: 'stream_hydration' },
						extra: { sessionId: input.sessionId, ...auth },
					})
				}),
			),
			Effect.tapError((error) => Effect.logError(error)),
			Effect.catchTag('DurableStreamSessionUnavailableError', () =>
				Effect.fail(errors.INTERNAL_SERVER_ERROR({})),
			),
		)

		yield* Effect.logInfo('Durable stream session hydrated for daemon').pipe(
			Effect.annotateLogs({
				sessionId: input.sessionId,
				organizationId: auth.organizationId,
				userId: auth.userId,
				status: result.status,
			}),
		)

		return result
	})
