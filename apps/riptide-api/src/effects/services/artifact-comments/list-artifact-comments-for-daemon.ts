import { Effect } from 'effect'

import { listArtifactComments } from './list-artifact-comments'

export const listArtifactCommentsForDaemon = Effect.fn('artifact_comments.list_for_daemon')(function* (input: unknown) {
	return yield* listArtifactComments(input)
})
