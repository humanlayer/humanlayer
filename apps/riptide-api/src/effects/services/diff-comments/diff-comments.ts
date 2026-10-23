import { Context, type Effect } from 'effect'

import type { PostgresDb } from '../postgres/postgres-db.service'
import type {
	DiffCommentForbidden,
	DiffCommentIdAmbiguous,
	DiffCommentInvalidInput,
	DiffCommentInvalidRow,
	DiffCommentNotFound,
	DiffCommentsUnavailable,
} from './diff-comments-errors'
import type {
	CommentMutationResult,
	CreatedCommentResult,
	DaemonBatchResult,
	DaemonReplyResult,
	DiffCommentThreadList,
	ResolveCommentsResult,
} from './diff-comments-types'

type DiffCommentError =
	| DiffCommentNotFound
	| DiffCommentForbidden
	| DiffCommentIdAmbiguous
	| DiffCommentInvalidInput
	| DiffCommentInvalidRow
	| DiffCommentsUnavailable

/**
 * Owns diff-comment validation, organization-scoped persistence, direct-root
 * thread rules, and daemon short-ID workflows.
 */
export class DiffComments extends Context.Service<
	DiffComments,
	{
		readonly create: (input: unknown) => Effect.Effect<CreatedCommentResult, DiffCommentError, PostgresDb>
		readonly reply: (input: unknown) => Effect.Effect<CreatedCommentResult, DiffCommentError, PostgresDb>
		readonly edit: (input: unknown) => Effect.Effect<CommentMutationResult, DiffCommentError, PostgresDb>
		readonly delete: (input: unknown) => Effect.Effect<CommentMutationResult, DiffCommentError, PostgresDb>
		readonly setThreadResolved: (
			input: unknown,
		) => Effect.Effect<CommentMutationResult, DiffCommentError, PostgresDb>
		readonly resolveBatch: (input: unknown) => Effect.Effect<ResolveCommentsResult, DiffCommentError, PostgresDb>
		readonly listForDaemon: (input: unknown) => Effect.Effect<DiffCommentThreadList, DiffCommentError, PostgresDb>
		readonly replyForDaemon: (input: unknown) => Effect.Effect<DaemonReplyResult, DiffCommentError, PostgresDb>
		readonly updateBatchForDaemon: (
			input: unknown,
		) => Effect.Effect<DaemonBatchResult<'not_found' | 'ambiguous' | 'forbidden'>, DiffCommentError, PostgresDb>
	}
>()('DiffComments') {}
