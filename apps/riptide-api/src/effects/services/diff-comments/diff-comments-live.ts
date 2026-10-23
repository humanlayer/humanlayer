import { diffComments as diffCommentRows } from '@humanlayer/db/tables/diff-comments'
import { tasks } from '@humanlayer/db/tables/tasks'
import { DiffCommentAnchorSchema } from '@humanlayer/db/zodschemas/diff-comment-anchor'
import * as Sentry from '@sentry/node'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Clock, Effect, Layer, Schema } from 'effect'
import { uuidv7 } from 'uuidv7'

import { getTransactionId } from '../postgres/helpers'
import type { PostgresDbQueryError, PostgresDbTransactionError } from '../postgres/postgres-db.errors'
import { PostgresDb, type PostgresTransaction } from '../postgres/postgres-db.service'
import {
	buildDiffCommentIndex,
	findDiffCommentByUniqueSuffix,
	getDiffCommentRoot,
	isDirectDiffCommentReply,
} from './diff-comment-threads'
import { DiffComments } from './diff-comments'
import {
	DiffCommentForbidden,
	DiffCommentIdAmbiguous,
	DiffCommentInvalidInput,
	DiffCommentInvalidRow,
	DiffCommentNotFound,
	DiffCommentsUnavailable,
} from './diff-comments-errors'
import {
	CreateDiffCommentInput,
	DeleteDiffCommentInput,
	EditDiffCommentInput,
	ListDiffCommentsForDaemonInput,
	ReplyToDiffCommentForDaemonInput,
	ReplyToDiffCommentInput,
	ResolveDiffCommentsInput,
	SetDiffCommentThreadResolvedInput,
	UpdateDiffCommentsForDaemonInput,
} from './diff-comments-types'

const failDiffCommentsUnavailable = <DatabaseError extends { readonly retryable: boolean }>(error: DatabaseError) => {
	const retryable = error.retryable
	return Effect.logError('Diff comments database operation failed', error).pipe(
		Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
		Effect.andThen(Effect.fail(new DiffCommentsUnavailable({ retryable }))),
	)
}

type DiffCommentOperationError =
	| DiffCommentForbidden
	| DiffCommentIdAmbiguous
	| DiffCommentInvalidInput
	| DiffCommentInvalidRow
	| DiffCommentNotFound
	| DiffCommentsUnavailable

/** Parses transport input at the diff-comment service boundary. */
const decodeDiffCommentInput = <S extends Schema.Top>(schema: S, input: unknown) =>
	Schema.decodeUnknownEffect(schema)(input).pipe(
		Effect.mapError(() => new DiffCommentInvalidInput({ message: 'Invalid diff comment input' })),
	)
/** Captures database failures before exposing the service's stable unavailable error. */
const narrowDiffCommentDatabaseErrors = <A, R>(
	effect: Effect.Effect<A, DiffCommentOperationError | PostgresDbQueryError | PostgresDbTransactionError, R>,
) =>
	effect.pipe(
		Effect.catchTag('PostgresDbQueryError', failDiffCommentsUnavailable),
		Effect.catchTag('PostgresDbTransactionError', failDiffCommentsUnavailable),
	)

/** Finds a task only within the caller's organization boundary. */
const findOrganizationTaskById = (tx: PostgresTransaction, taskId: string, organizationId: string) =>
	tx
		.query(
			tx.client
				.select({ id: tasks.id, resourceOwnerUserId: tasks.resource_owner_user_id })
				.from(tasks)
				.where(and(eq(tasks.id, taskId), eq(tasks.organization_id, organizationId)))
				.limit(1),
		)
		.pipe(Effect.map((rows) => rows[0]))

/** Locks a task before a comment write copies its current owner. */
const findOrganizationTaskByIdForUpdate = (tx: PostgresTransaction, taskId: string, organizationId: string) =>
	tx
		.query(
			tx.client
				.select({ id: tasks.id, resourceOwnerUserId: tasks.resource_owner_user_id })
				.from(tasks)
				.where(and(eq(tasks.id, taskId), eq(tasks.organization_id, organizationId)))
				.limit(1)
				.for('no key update'),
		)
		.pipe(Effect.map((rows) => rows[0]))

/** Finds a diff comment only within the caller's organization boundary. */
const findOrganizationDiffCommentById = (tx: PostgresTransaction, commentId: string, organizationId: string) =>
	tx
		.query(
			tx.client
				.select()
				.from(diffCommentRows)
				.where(and(eq(diffCommentRows.id, commentId), eq(diffCommentRows.organization_id, organizationId)))
				.limit(1),
		)
		.pipe(Effect.map((rows) => rows[0]))

export const createDiffComment = Effect.fn('diff_comments.create')(function* (rawInput: unknown) {
	const decodedInput = yield* decodeDiffCommentInput(CreateDiffCommentInput, rawInput)
	const anchor = DiffCommentAnchorSchema.safeParse(decodedInput.anchor)
	if (!anchor.success)
		return yield* Effect.fail(new DiffCommentInvalidInput({ message: 'Invalid diff comment anchor' }))
	const input = { ...decodedInput, anchor: anchor.data }
	const postgres = yield* PostgresDb
	const now = BigInt(yield* Clock.currentTimeMillis)
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const task = yield* findOrganizationTaskByIdForUpdate(tx, input.taskId, input.userInfo.organizationId)
				if (!task) return yield* Effect.fail(new DiffCommentNotFound({ message: 'Task not found' }))
				const commentId = input.id ?? uuidv7()
				yield* tx.query(
					tx.client.insert(diffCommentRows).values({
						id: commentId,
						organization_id: input.userInfo.organizationId,
						resource_owner_user_id: task.resourceOwnerUserId,
						task_id: input.taskId,
						created_by_user_id: input.userInfo.userId,
						content_text: input.contentText,
						content_json: input.contentJson ?? null,
						anchor_json: input.anchor,
						reply_to_comment_id: null,
						created_at: now,
						updated_at: now,
						created_by_agent: input.userInfo.createdByAgent,
					}),
				)
				return { success: true as const, commentId, transactionId: yield* getTransactionId(tx) }
			}),
		)
		.pipe(narrowDiffCommentDatabaseErrors)
})

export const replyToDiffComment = Effect.fn('diff_comments.reply')(function* (rawInput: unknown) {
	const input = yield* decodeDiffCommentInput(ReplyToDiffCommentInput, rawInput)
	const postgres = yield* PostgresDb
	const now = BigInt(yield* Clock.currentTimeMillis)
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const task = yield* findOrganizationTaskByIdForUpdate(tx, input.taskId, input.userInfo.organizationId)
				if (!task) return yield* Effect.fail(new DiffCommentNotFound({ message: 'Task not found' }))
				const root = yield* findOrganizationDiffCommentById(
					tx,
					input.rootCommentId,
					input.userInfo.organizationId,
				)
				if (!root || root.task_id !== input.taskId || root.reply_to_comment_id !== null)
					return yield* Effect.fail(new DiffCommentNotFound({ message: 'Root comment not found' }))
				const commentId = input.id ?? uuidv7()
				yield* tx.query(
					tx.client
						.update(diffCommentRows)
						.set({ is_resolved: false, resolved_by_user_id: null, updated_at: now })
						.where(
							and(
								eq(diffCommentRows.id, root.id),
								eq(diffCommentRows.organization_id, input.userInfo.organizationId),
								eq(diffCommentRows.task_id, input.taskId),
							),
						),
				)
				yield* tx.query(
					tx.client.insert(diffCommentRows).values({
						id: commentId,
						organization_id: input.userInfo.organizationId,
						resource_owner_user_id: task.resourceOwnerUserId,
						task_id: input.taskId,
						created_by_user_id: input.userInfo.userId,
						reply_to_comment_id: root.id,
						anchor_json: null,
						content_text: input.contentText,
						content_json: input.contentJson ?? null,
						created_at: now,
						updated_at: now,
						created_by_agent: input.userInfo.createdByAgent,
					}),
				)
				return { success: true as const, commentId, transactionId: yield* getTransactionId(tx) }
			}),
		)
		.pipe(narrowDiffCommentDatabaseErrors)
})

export const editDiffComment = Effect.fn('diff_comments.edit')(function* (rawInput: unknown) {
	const input = yield* decodeDiffCommentInput(EditDiffCommentInput, rawInput)
	const postgres = yield* PostgresDb
	const now = BigInt(yield* Clock.currentTimeMillis)
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const comment = yield* findOrganizationDiffCommentById(
					tx,
					input.commentId,
					input.userInfo.organizationId,
				)
				if (!comment || comment.is_deleted)
					return yield* Effect.fail(new DiffCommentNotFound({ message: 'Comment not found' }))
				if (comment.created_by_user_id !== input.userInfo.userId)
					return yield* Effect.fail(new DiffCommentForbidden({ message: 'Only the comment author can edit' }))
				yield* tx.query(
					tx.client
						.update(diffCommentRows)
						.set({
							content_text: input.contentText,
							content_json: input.contentJson ?? null,
							updated_at: now,
						})
						.where(
							and(
								eq(diffCommentRows.id, comment.id),
								eq(diffCommentRows.organization_id, input.userInfo.organizationId),
							),
						),
				)
				return { success: true as const, transactionId: yield* getTransactionId(tx) }
			}),
		)
		.pipe(narrowDiffCommentDatabaseErrors)
})

export const deleteDiffComment = Effect.fn('diff_comments.delete')(function* (rawInput: unknown) {
	const input = yield* decodeDiffCommentInput(DeleteDiffCommentInput, rawInput)
	const postgres = yield* PostgresDb
	const now = BigInt(yield* Clock.currentTimeMillis)
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const comment = yield* findOrganizationDiffCommentById(
					tx,
					input.commentId,
					input.userInfo.organizationId,
				)
				if (!comment || comment.is_deleted)
					return yield* Effect.fail(new DiffCommentNotFound({ message: 'Comment not found' }))
				if (comment.created_by_user_id !== input.userInfo.userId)
					return yield* Effect.fail(
						new DiffCommentForbidden({ message: 'Only the comment author can delete' }),
					)
				yield* tx.query(
					tx.client
						.update(diffCommentRows)
						.set({ is_deleted: true, updated_at: now })
						.where(
							and(
								eq(diffCommentRows.id, comment.id),
								eq(diffCommentRows.organization_id, input.userInfo.organizationId),
							),
						),
				)
				return { success: true as const, transactionId: yield* getTransactionId(tx) }
			}),
		)
		.pipe(narrowDiffCommentDatabaseErrors)
})

export const setDiffCommentThreadResolved = Effect.fn('diff_comments.set_thread_resolved')(function* (
	rawInput: unknown,
) {
	const input = yield* decodeDiffCommentInput(SetDiffCommentThreadResolvedInput, rawInput)
	const postgres = yield* PostgresDb
	const now = BigInt(yield* Clock.currentTimeMillis)
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const comment = yield* findOrganizationDiffCommentById(
					tx,
					input.commentId,
					input.userInfo.organizationId,
				)
				const root = comment?.reply_to_comment_id
					? yield* findOrganizationDiffCommentById(
							tx,
							comment.reply_to_comment_id,
							input.userInfo.organizationId,
						)
					: comment
				if (!root) return yield* Effect.fail(new DiffCommentNotFound({ message: 'Thread not found' }))
				if (root.is_deleted) {
					const liveReply = yield* tx.query(
						tx.client
							.select({ id: diffCommentRows.id })
							.from(diffCommentRows)
							.where(
								and(
									eq(diffCommentRows.organization_id, input.userInfo.organizationId),
									eq(diffCommentRows.reply_to_comment_id, root.id),
									eq(diffCommentRows.is_deleted, false),
								),
							)
							.limit(1),
					)
					if (!liveReply[0])
						return yield* Effect.fail(new DiffCommentNotFound({ message: 'Thread not found' }))
				}
				yield* tx.query(
					tx.client
						.update(diffCommentRows)
						.set({
							is_resolved: input.isResolved,
							resolved_by_user_id: input.isResolved ? input.userInfo.userId : null,
							updated_at: now,
						})
						.where(
							and(
								eq(diffCommentRows.id, root.id),
								eq(diffCommentRows.organization_id, input.userInfo.organizationId),
							),
						),
				)
				return { success: true as const, transactionId: yield* getTransactionId(tx) }
			}),
		)
		.pipe(narrowDiffCommentDatabaseErrors)
})

export const resolveDiffComments = Effect.fn('diff_comments.resolve_batch')(function* (rawInput: unknown) {
	const input = yield* decodeDiffCommentInput(ResolveDiffCommentsInput, rawInput)
	const postgres = yield* PostgresDb
	const now = BigInt(yield* Clock.currentTimeMillis)
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				if (!(yield* findOrganizationTaskById(tx, input.taskId, input.userInfo.organizationId)))
					return yield* Effect.fail(new DiffCommentNotFound({ message: 'Task not found' }))
				const roots = yield* tx.query(
					tx.client
						.select({ id: diffCommentRows.id, isResolved: diffCommentRows.is_resolved })
						.from(diffCommentRows)
						.where(
							and(
								eq(diffCommentRows.organization_id, input.userInfo.organizationId),
								eq(diffCommentRows.task_id, input.taskId),
								inArray(diffCommentRows.id, [...input.rootCommentIds]),
								isNull(diffCommentRows.reply_to_comment_id),
								eq(diffCommentRows.is_deleted, false),
							),
						),
				)
				if (roots.length !== new Set(input.rootCommentIds).size)
					return yield* Effect.fail(
						new DiffCommentNotFound({ message: 'One or more root comments were not found' }),
					)
				const ids = roots.filter((root) => !root.isResolved).map((root) => root.id)
				if (ids.length)
					yield* tx.query(
						tx.client
							.update(diffCommentRows)
							.set({ is_resolved: true, resolved_by_user_id: input.userInfo.userId, updated_at: now })
							.where(and(inArray(diffCommentRows.id, ids), eq(diffCommentRows.is_resolved, false))),
					)
				return { success: true as const, resolvedCount: ids.length, transactionId: yield* getTransactionId(tx) }
			}),
		)
		.pipe(narrowDiffCommentDatabaseErrors)
})

/** Projects a persisted comment into the compact daemon-facing representation. */
const projectDiffCommentForDaemon = (comment: typeof diffCommentRows.$inferSelect) => ({
	id: comment.id,
	truncatedId: comment.id.slice(-12),
	createdByUserId: comment.created_by_user_id,
	createdByAgent: comment.created_by_agent,
	contentText: comment.content_text,
	isDeleted: comment.is_deleted,
})

export const listDiffCommentsForDaemon = Effect.fn('diff_comments.list_for_daemon')(function* (rawInput: unknown) {
	const input = yield* decodeDiffCommentInput(ListDiffCommentsForDaemonInput, rawInput)
	const postgres = yield* PostgresDb
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				if (!(yield* findOrganizationTaskById(tx, input.taskId, input.userInfo.organizationId)))
					return yield* Effect.fail(new DiffCommentNotFound({ message: 'Task not found' }))
				const rows = yield* tx.query(
					tx.client
						.select()
						.from(diffCommentRows)
						.where(
							and(
								eq(diffCommentRows.organization_id, input.userInfo.organizationId),
								eq(diffCommentRows.task_id, input.taskId),
							),
						)
						.orderBy(asc(diffCommentRows.created_at), asc(diffCommentRows.id)),
				)
				const rowsById = buildDiffCommentIndex(rows)
				const comments = []
				for (const root of rows) {
					if (
						getDiffCommentRoot(root, rowsById)?.id !== root.id ||
						(!input.includeResolved && root.is_resolved)
					)
						continue
					const replies = rows.filter((row) => isDirectDiffCommentReply(row, root))
					if (root.is_deleted && !replies.some((reply) => !reply.is_deleted)) continue
					const parsed = DiffCommentAnchorSchema.safeParse(root.anchor_json)
					if (!parsed.success) {
						yield* Effect.logError('Failed to parse persisted diff comment anchor', parsed.error).pipe(
							Effect.annotateLogs({ commentId: root.id, taskId: input.taskId }),
						)
						yield* Effect.sync(() => Sentry.captureException(parsed.error))
						return yield* Effect.fail(
							new DiffCommentInvalidRow({ message: `Diff comment ${root.id} has an invalid anchor` }),
						)
					}
					comments.push({
						root: projectDiffCommentForDaemon(root),
						replies: replies.map(projectDiffCommentForDaemon),
						anchor: parsed.data,
						isResolved: root.is_resolved,
					})
				}
				return { comments }
			}),
		)
		.pipe(narrowDiffCommentDatabaseErrors)
})

export const replyToDiffCommentForDaemon = Effect.fn('diff_comments.reply_for_daemon')(function* (rawInput: unknown) {
	const input = yield* decodeDiffCommentInput(ReplyToDiffCommentForDaemonInput, rawInput)
	const postgres = yield* PostgresDb
	const now = BigInt(yield* Clock.currentTimeMillis)
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const task = yield* findOrganizationTaskByIdForUpdate(tx, input.taskId, input.userInfo.organizationId)
				if (!task) return yield* Effect.fail(new DiffCommentNotFound({ message: 'Task not found' }))
				const rows = yield* tx.query(
					tx.client
						.select()
						.from(diffCommentRows)
						.where(
							and(
								eq(diffCommentRows.organization_id, input.userInfo.organizationId),
								eq(diffCommentRows.task_id, input.taskId),
							),
						),
				)
				const match = findDiffCommentByUniqueSuffix(rows, input.truncatedCommentId)
				if (match.kind === 'not_found')
					return yield* Effect.fail(new DiffCommentNotFound({ message: 'Diff comment not found' }))
				if (match.kind === 'ambiguous')
					return yield* Effect.fail(
						new DiffCommentIdAmbiguous({ message: 'Ambiguous diff comment ID suffix' }),
					)
				const root = getDiffCommentRoot(match.comment, buildDiffCommentIndex(rows))
				if (!root)
					return yield* Effect.fail(new DiffCommentNotFound({ message: 'Diff comment thread not found' }))
				const commentId = uuidv7()
				yield* tx.query(
					tx.client
						.update(diffCommentRows)
						.set({ is_resolved: false, resolved_by_user_id: null, updated_at: now })
						.where(
							and(
								eq(diffCommentRows.id, root.id),
								eq(diffCommentRows.organization_id, input.userInfo.organizationId),
								eq(diffCommentRows.task_id, input.taskId),
							),
						),
				)
				yield* tx.query(
					tx.client.insert(diffCommentRows).values({
						id: commentId,
						organization_id: input.userInfo.organizationId,
						resource_owner_user_id: task.resourceOwnerUserId,
						task_id: input.taskId,
						created_by_user_id: input.userInfo.userId,
						reply_to_comment_id: root.id,
						anchor_json: null,
						content_text: input.contentText,
						content_json: null,
						created_at: now,
						updated_at: now,
						created_by_agent: input.userInfo.createdByAgent,
					}),
				)
				return {
					success: true as const,
					commentId,
					parentCommentId: root.id,
					transactionId: yield* getTransactionId(tx),
				}
			}),
		)
		.pipe(narrowDiffCommentDatabaseErrors)
})

export const updateDiffCommentsForDaemon = Effect.fn('diff_comments.update_batch_for_daemon')(function* (
	rawInput: unknown,
) {
	const input = yield* decodeDiffCommentInput(UpdateDiffCommentsForDaemonInput, rawInput)
	const postgres = yield* PostgresDb
	const now = BigInt(yield* Clock.currentTimeMillis)
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				if (!(yield* findOrganizationTaskById(tx, input.taskId, input.userInfo.organizationId)))
					return yield* Effect.fail(new DiffCommentNotFound({ message: 'Task not found' }))
				const rows = yield* tx.query(
					tx.client
						.select()
						.from(diffCommentRows)
						.where(
							and(
								eq(diffCommentRows.organization_id, input.userInfo.organizationId),
								eq(diffCommentRows.task_id, input.taskId),
							),
						),
				)
				const index = buildDiffCommentIndex(rows)
				const roots = new Set<string>()
				const deletes = new Set<string>()
				const updated = []
				const failed: Array<{ truncatedId: string; reason: 'not_found' | 'ambiguous' | 'forbidden' }> = []
				for (const truncatedId of input.truncatedCommentIds) {
					const match = findDiffCommentByUniqueSuffix(rows, truncatedId)
					if (match.kind !== 'found') {
						failed.push({ truncatedId, reason: match.kind })
						continue
					}
					if (input.deleted && match.comment.created_by_user_id !== input.userInfo.userId) {
						failed.push({ truncatedId, reason: 'forbidden' })
						continue
					}
					if (input.resolved !== undefined) {
						const root = getDiffCommentRoot(match.comment, index)
						if (
							!root ||
							(root.is_deleted &&
								!rows.some((row) => isDirectDiffCommentReply(row, root) && !row.is_deleted))
						) {
							failed.push({ truncatedId, reason: 'not_found' })
							continue
						}
						roots.add(root.id)
					}
					if (input.deleted) deletes.add(match.comment.id)
					updated.push({ truncatedId, commentId: match.comment.id })
				}
				if (input.resolved !== undefined && roots.size)
					yield* tx.query(
						tx.client
							.update(diffCommentRows)
							.set({
								is_resolved: input.resolved,
								resolved_by_user_id: input.resolved ? input.userInfo.userId : null,
								updated_at: now,
							})
							.where(
								and(
									inArray(diffCommentRows.id, [...roots]),
									eq(diffCommentRows.organization_id, input.userInfo.organizationId),
									eq(diffCommentRows.task_id, input.taskId),
								),
							),
					)
				if (input.deleted && deletes.size)
					yield* tx.query(
						tx.client
							.update(diffCommentRows)
							.set({ is_deleted: true, updated_at: now })
							.where(
								and(
									inArray(diffCommentRows.id, [...deletes]),
									eq(diffCommentRows.created_by_user_id, input.userInfo.userId),
									eq(diffCommentRows.organization_id, input.userInfo.organizationId),
									eq(diffCommentRows.task_id, input.taskId),
								),
							),
					)
				return { success: updated.length > 0, updated, failed, transactionId: yield* getTransactionId(tx) }
			}),
		)
		.pipe(narrowDiffCommentDatabaseErrors)
})

export const DiffCommentsLive: Layer.Layer<DiffComments, never, PostgresDb> = Layer.succeed(
	DiffComments,
	DiffComments.of({
		create: createDiffComment,
		reply: replyToDiffComment,
		edit: editDiffComment,
		delete: deleteDiffComment,
		setThreadResolved: setDiffCommentThreadResolved,
		resolveBatch: resolveDiffComments,
		listForDaemon: listDiffCommentsForDaemon,
		replyForDaemon: replyToDiffCommentForDaemon,
		updateBatchForDaemon: updateDiffCommentsForDaemon,
	}),
)
