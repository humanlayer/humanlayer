import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { effectOrpcBasePublic } from '../../../effect-base'
import { undoPublicComment } from './public-comments'

export const undoPublicArtifactCommentProcedure = effectOrpcBasePublic.public.artifacts.undoComment.effect(function* ({
	input,
	errors,
}) {
	return yield* undoPublicComment(input).pipe(
		Effect.catchTags({
			PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
			PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			PublicCommentNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
			PublicCommentValidationError: (error) =>
				Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
		}),
	)
})
