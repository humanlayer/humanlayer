import { Context, type Effect } from 'effect'

import type { OnboardingService } from '../onboarding/onboarding.service'
import type { PostgresDb } from '../postgres/postgres-db.service'
import type { SlackService } from '../slack/slack.service'
import type { WorkosService } from '../workos/workos.service'
import type {
	ArtifactCommentForbidden,
	ArtifactCommentIdAmbiguous,
	ArtifactCommentInvalid,
	ArtifactCommentInvalidInput,
	ArtifactCommentInvalidRow,
	ArtifactCommentNotFound,
	ArtifactCommentsUnavailable,
} from './artifact-comments-errors'
import type {
	ArtifactCommentsForDaemon,
	ArtifactCommentsForUser,
	ArtifactDaemonReplyResult,
	CommentMutationResult,
	CreateArtifactCommentResult,
	DaemonBatchResult,
	ResolveArtifactCommentsResult,
} from './artifact-comments-types'

type ArtifactCommentError =
	| ArtifactCommentNotFound
	| ArtifactCommentForbidden
	| ArtifactCommentIdAmbiguous
	| ArtifactCommentInvalid
	| ArtifactCommentInvalidInput
	| ArtifactCommentInvalidRow
	| ArtifactCommentsUnavailable

type ArtifactCommentRequirements = PostgresDb | WorkosService | OnboardingService | SlackService

/**
 * Owns artifact-comment validation, authorization, persistence, thread rules,
 * projections, and post-commit integrations. Transport handlers only supply
 * caller context and map domain errors to API responses.
 */
export class ArtifactComments extends Context.Service<
	ArtifactComments,
	{
		readonly create: (
			input: unknown,
		) => Effect.Effect<CreateArtifactCommentResult, ArtifactCommentError, ArtifactCommentRequirements>
		readonly list: (
			input: unknown,
		) => Effect.Effect<ArtifactCommentsForUser, ArtifactCommentError, ArtifactCommentRequirements>
		readonly reply: (
			input: unknown,
		) => Effect.Effect<ArtifactDaemonReplyResult, ArtifactCommentError, ArtifactCommentRequirements>
		readonly edit: (
			input: unknown,
		) => Effect.Effect<CommentMutationResult, ArtifactCommentError, ArtifactCommentRequirements>
		readonly delete: (
			input: unknown,
		) => Effect.Effect<CommentMutationResult, ArtifactCommentError, ArtifactCommentRequirements>
		readonly setThreadResolved: (
			input: unknown,
		) => Effect.Effect<ResolveArtifactCommentsResult, ArtifactCommentError, ArtifactCommentRequirements>
		readonly resolveAll: (
			input: unknown,
		) => Effect.Effect<ResolveArtifactCommentsResult, ArtifactCommentError, ArtifactCommentRequirements>
		readonly resolveBatch: (
			input: unknown,
		) => Effect.Effect<ResolveArtifactCommentsResult, ArtifactCommentError, ArtifactCommentRequirements>
		readonly listForDaemon: (
			input: unknown,
		) => Effect.Effect<ArtifactCommentsForDaemon, ArtifactCommentError, ArtifactCommentRequirements>
		readonly replyForDaemon: (
			input: unknown,
		) => Effect.Effect<ArtifactDaemonReplyResult, ArtifactCommentError, ArtifactCommentRequirements>
		readonly updateBatch: (
			input: unknown,
		) => Effect.Effect<
			DaemonBatchResult<'not_found' | 'ambiguous'>,
			ArtifactCommentError,
			ArtifactCommentRequirements
		>
		readonly updateBatchForDaemon: (
			input: unknown,
		) => Effect.Effect<
			DaemonBatchResult<'not_found' | 'ambiguous'>,
			ArtifactCommentError,
			ArtifactCommentRequirements
		>
	}
>()('ArtifactComments') {}
