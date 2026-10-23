import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { effectOrpcBasePublic } from '../../../effect-base'
import { writePublicComment } from './public-comments'

export const createPublicArtifactCommentProcedure = effectOrpcBasePublic.public.artifacts.createComment.effect(
	function* ({ input, context, errors }) {
		return yield* writePublicComment({ ...input, requestIp: context.requestIp }).pipe(
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				PublicCommentNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
				PublicCommentValidationError: (error) =>
					Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
				GuestIdentityConflictError: () =>
					Effect.fail(errors.GUEST_IDENTITY_CONFLICT({ data: { message: 'Guest identity does not match' } })),
				PublicCommentRateLimitedError: (error) =>
					Effect.fail(
						errors.PUBLIC_COMMENT_RATE_LIMITED({
							data: {
								message: 'Too many comments. Try again shortly.',
								retryAfterSeconds: error.retryAfterSeconds,
							},
						}),
					),
			}),
		)
	},
)
