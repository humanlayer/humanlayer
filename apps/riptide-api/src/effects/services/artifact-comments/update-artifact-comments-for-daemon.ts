import { Effect } from 'effect'

import { updateArtifactComments } from './update-artifact-comments'

export const updateArtifactCommentsForDaemon = Effect.fn('artifact_comments.update_batch_for_daemon')(function* (
	input: unknown,
) {
	return yield* updateArtifactComments(input, { markUpdatedByAgent: false })
})
