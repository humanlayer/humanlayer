import { Data } from 'effect'

export class DiffCommentNotFound extends Data.TaggedError('DiffCommentNotFound')<{ readonly message: string }> {}
export class DiffCommentForbidden extends Data.TaggedError('DiffCommentForbidden')<{ readonly message: string }> {}
export class DiffCommentIdAmbiguous extends Data.TaggedError('DiffCommentIdAmbiguous')<{ readonly message: string }> {}
export class DiffCommentInvalidInput extends Data.TaggedError('DiffCommentInvalidInput')<{
	readonly message: string
}> {}
export class DiffCommentInvalidRow extends Data.TaggedError('DiffCommentInvalidRow')<{ readonly message: string }> {}
export class DiffCommentsUnavailable extends Data.TaggedError('DiffCommentsUnavailable')<{
	readonly retryable: boolean
}> {}
