import { Effect } from 'effect'

import { updateArtifactComments } from './update-artifact-comments'

export const updateArtifactCommentsForUser = Effect.fn('artifact_comments.update_batch')(function* (input: unknown) {
	return yield* updateArtifactComments(input, { markUpdatedByAgent: true })
})
