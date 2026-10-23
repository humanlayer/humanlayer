import { Layer } from 'effect'

import type { OnboardingService } from '../onboarding/onboarding.service'
import type { PostgresDb } from '../postgres/postgres-db.service'
import type { SlackService } from '../slack/slack.service'
import type { WorkosService } from '../workos/workos.service'
import { ArtifactComments } from './artifact-comments'
import { createArtifactComment } from './create-artifact-comment'
import { deleteArtifactComment } from './delete-artifact-comment'
import { editArtifactComment } from './edit-artifact-comment'
import { listArtifactComments } from './list-artifact-comments'
import { listArtifactCommentsForDaemon } from './list-artifact-comments-for-daemon'
import { replyToArtifactComment } from './reply-to-artifact-comment'
import { replyToArtifactCommentForDaemon } from './reply-to-artifact-comment-for-daemon'
import { resolveAllArtifactComments } from './resolve-all-artifact-comments'
import { resolveArtifactComments } from './resolve-artifact-comments'
import { setArtifactCommentThreadResolved } from './set-artifact-comment-thread-resolved'
import { updateArtifactCommentsForDaemon } from './update-artifact-comments-for-daemon'
import { updateArtifactCommentsForUser } from './update-artifact-comments-for-user'

export const ArtifactCommentsLive: Layer.Layer<
	ArtifactComments,
	never,
	PostgresDb | WorkosService | OnboardingService | SlackService
> = Layer.succeed(
	ArtifactComments,
	ArtifactComments.of({
		create: createArtifactComment,
		list: listArtifactComments,
		reply: replyToArtifactComment,
		edit: editArtifactComment,
		delete: deleteArtifactComment,
		setThreadResolved: setArtifactCommentThreadResolved,
		resolveAll: resolveAllArtifactComments,
		resolveBatch: resolveArtifactComments,
		listForDaemon: listArtifactCommentsForDaemon,
		replyForDaemon: replyToArtifactCommentForDaemon,
		updateBatch: updateArtifactCommentsForUser,
		updateBatchForDaemon: updateArtifactCommentsForDaemon,
	}),
)
