import { Effect } from 'effect'

import { DurableStreamSessionService } from '../../../../effects/services/durable-streams/streams'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

export const getOrHydrateDurableStreamSessionsProcedure =
	effectOrpcBaseOrganizationRequired.durableStreams.sessions.getOrHydrate.effect(function* ({
		input,
		context,
		errors,
	}) {
		const durableStreams = yield* DurableStreamSessionService
		const auth = {
			organizationId: context.auth.organizationId,
			userId: context.auth.userId,
		}

		const requestedSessionIds = Array.from(new Set(input.sessionIds))
		yield* Effect.annotateCurrentSpan({
			organization_id: auth.organizationId,
			user_id: auth.userId,
			session_count: requestedSessionIds.length,
		})

		const authorizedSessionIds = yield* durableStreams
			.authorizeSessions({
				organizationId: context.auth.organizationId,
				sessionIds: requestedSessionIds,
			})
			.pipe(
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTag('DurableStreamSessionUnavailableError', () =>
					Effect.fail(errors.INTERNAL_SERVER_ERROR({})),
				),
			)

		const sessionSetsMatch =
			requestedSessionIds.length === authorizedSessionIds.size &&
			requestedSessionIds.every((sessionId) => authorizedSessionIds.has(sessionId))

		yield* Effect.suspend(() =>
			sessionSetsMatch
				? Effect.void
				: Effect.fail(new Error('User requested to hydrate sessions they are not authorized to access')),
		).pipe(
			Effect.tapError((error) => Effect.logError(error)),
			Effect.tapError((error) =>
				Effect.sync(() => {
					Sentry.captureException(error, {
						extra: {
							...auth,
							authorizedSessionIds: Array.from(authorizedSessionIds),
							requestedSessionIds,
						},
					})
				}),
			),
			Effect.mapError(() =>
				errors.NOT_FOUND({ message: 'One or more of the requested session IDs was not found.' }),
			),
		)

		const result = yield* durableStreams.getOrHydrateSessions({ sessionIds: requestedSessionIds, auth }).pipe(
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTag('DurableStreamSessionUnavailableError', () =>
				Effect.fail(errors.INTERNAL_SERVER_ERROR({})),
			),
		)

		yield* Effect.logInfo('Durable stream sessions hydrated').pipe(
			Effect.annotateLogs({
				organizationId: auth.organizationId,
				userId: auth.userId,
				sessionCount: result.streams.length,
			}),
		)

		return result
	})
