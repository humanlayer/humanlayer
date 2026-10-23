import { Effect } from 'effect'

import { replyToArtifactComment } from './reply-to-artifact-comment'

export const replyToArtifactCommentForDaemon = Effect.fn('artifact_comments.reply_for_daemon')(function* (
	input: unknown,
) {
	return yield* replyToArtifactComment(input)
})
