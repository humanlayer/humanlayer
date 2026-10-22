import { Effect } from 'effect'

import { DiffComments } from '../../../effects/services/diff-comments/diff-comments'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

export const replyToDiffCommentProcedure = effectOrpcDaemonBase.diffComments.reply
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const diffComments = yield* DiffComments
		const { organizationId, userId } = context.auth
		return yield* diffComments
			.replyForDaemon({
				...input,
				userInfo: { organizationId, userId, createdByAgent: true },
			})
			.pipe(
				Effect.catchTags({
					DiffCommentNotFound: (error) => Effect.fail(errors.NOT_FOUND({ data: { message: error.message } })),
					DiffCommentForbidden: (error) =>
						Effect.fail(errors.FORBIDDEN({ data: { message: error.message } })),
					DiffCommentIdAmbiguous: (error) =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
					DiffCommentInvalidInput: (error) =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
					DiffCommentInvalidRow: () => Effect.fail(errors.INTERNAL_SERVER_ERROR()),
					DiffCommentsUnavailable: (error) =>
						Effect.fail(error.retryable ? errors.SERVICE_UNAVAILABLE() : errors.INTERNAL_SERVER_ERROR()),
				}),
			)
	})
