import { Data } from 'effect'

export class ArtifactCommentNotFound extends Data.TaggedError('ArtifactCommentNotFound')<{
	readonly message: string
	readonly validArtifacts?: ReadonlyArray<string>
}> {}
export class ArtifactCommentInvalid extends Data.TaggedError('ArtifactCommentInvalid')<{ readonly message: string }> {}
export class ArtifactCommentInvalidInput extends Data.TaggedError('ArtifactCommentInvalidInput')<{
	readonly message: string
}> {}
export class ArtifactCommentInvalidRow extends Data.TaggedError('ArtifactCommentInvalidRow')<{
	readonly message: string
}> {}
export class ArtifactCommentForbidden extends Data.TaggedError('ArtifactCommentForbidden')<{
	readonly message: string
}> {}
export class ArtifactCommentIdAmbiguous extends Data.TaggedError('ArtifactCommentIdAmbiguous')<{
	readonly message: string
}> {}
export class ArtifactCommentsUnavailable extends Data.TaggedError('ArtifactCommentsUnavailable')<{
	readonly retryable: boolean
}> {}
