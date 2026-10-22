import { Data } from 'effect'

export class NextStepExtractionError extends Data.TaggedError('NextStepExtractionError')<{
	message: string
	cause?: unknown
}> {}
