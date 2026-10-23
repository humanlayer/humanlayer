import { Effect } from 'effect'

import { DiffComments } from '../../../effects/services/diff-comments/diff-comments'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

export const updateDiffCommentsProcedure = effectOrpcDaemonBase.diffComments.update
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		if (input.resolved === undefined && input.deleted === undefined) {
			return yield* Effect.fail(
				errors.BAD_REQUEST({ data: { message: 'At least one of resolved or deleted must be provided' } }),
			)
		}

		const diffComments = yield* DiffComments
		const { organizationId, userId } = context.auth
		const result = yield* diffComments
			.updateBatchForDaemon({
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
		return { ...result, updated: [...result.updated], failed: [...result.failed] }
	})
