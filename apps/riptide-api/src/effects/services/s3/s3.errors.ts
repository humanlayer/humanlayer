import { Data } from 'effect'

export class S3PresignError extends Data.TaggedError('S3PresignError')<{
	readonly operation: 'download' | 'upload'
	readonly cause: unknown
}> {}

export class S3UploadError extends Data.TaggedError('S3UploadError')<{
	readonly status: number | null
	readonly cause: unknown
}> {}
