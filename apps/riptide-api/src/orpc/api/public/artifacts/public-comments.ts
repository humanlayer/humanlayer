import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { effectivePublicPermission } from '@humanlayer/db/artifact-public-permission'
import { anonymousArtifactCommenters, artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { publicCommentUndoAuthorizations } from '@humanlayer/db/tables/public-comment-undo-authorizations'
import type { ArtifactCommentAnchor } from '@humanlayer/db/zodschemas/artifact-comment-anchor'
import { and, eq, ne, sql } from 'drizzle-orm'
import { Clock, Data, Effect } from 'effect'

import { insertThreadComment } from '../../../../effects/services/artifact-comments/insert-thread-comment'
import { getTransactionId } from '../../../../effects/services/postgres/helpers'
import { PostgresDb, type PostgresTransaction } from '../../../../effects/services/postgres/postgres-db.service'

export class PublicCommentNotFoundError extends Data.TaggedError('PublicCommentNotFoundError')<{}> {}
export class PublicCommentValidationError extends Data.TaggedError('PublicCommentValidationError')<{
	message: string
}> {}
export class GuestIdentityConflictError extends Data.TaggedError('GuestIdentityConflictError')<{}> {}
export class PublicCommentRateLimitedError extends Data.TaggedError('PublicCommentRateLimitedError')<{
	retryAfterSeconds: number
}> {}

export interface PublicCommentGuestIdentity {
	anonymousAuthorId: string
	guestName: string
	guestEmail?: string
}

interface WritePublicCommentInput {
	artifactId: string
	shareKey: string
	requestIp?: string
	id?: string
	contentText: string
	contentJson?: unknown
	anchorJson?: ArtifactCommentAnchor
	rootCommentId?: string
	guestIdentity: PublicCommentGuestIdentity
}

const WINDOW_MS = 60_000
const RATE_LIMIT = 10
const UNDO_LIFETIME_MS = 60_000
const rateWindows = new Map<string, { startedAt: number; count: number }>()

function enforceRateLimit(input: WritePublicCommentInput) {
	const now = Date.now()
	const key = `${input.requestIp ?? 'unknown'}:${input.artifactId}`
	const current = rateWindows.get(key)
	if (!current || now - current.startedAt >= WINDOW_MS) {
		rateWindows.set(key, { startedAt: now, count: 1 })
		return Effect.void
	}
	if (current.count >= RATE_LIMIT) {
		return Effect.fail(
			new PublicCommentRateLimitedError({
				retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - current.startedAt)) / 1000)),
			}),
		)
	}
	current.count += 1
	return Effect.void
}

function selectOrgPublicLinkPolicy(tx: PostgresTransaction, organizationId: string) {
	return tx
		.query(
			tx.client
				.select({ publicLinksAllowed: organizationSettings.enable_creating_publicly_shareable_links })
				.from(organizationSettings)
				.where(eq(organizationSettings.organization_id, organizationId))
				.limit(1),
		)
		.pipe(Effect.map(([row]) => ({ publicLinksAllowed: row?.publicLinksAllowed ?? true })))
}

function normalized(value: string | undefined): string | null {
	return value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase() || null
}

export function writePublicComment(input: WritePublicCommentInput) {
	return Effect.gen(function* () {
		yield* enforceRateLimit(input)

		const db = yield* PostgresDb
		const now = yield* Clock.currentTimeMillis
		return yield* db.transaction((tx) =>
			Effect.gen(function* () {
				const [artifact] = yield* tx.query(
					tx.client.select().from(artifacts).where(eq(artifacts.id, input.artifactId)).limit(1).for('update'),
				)
				if (!artifact?.task_id) return yield* Effect.fail(new PublicCommentNotFoundError())
				const org = yield* selectOrgPublicLinkPolicy(tx, artifact.organization_id)
				if (artifact.share_key !== input.shareKey || effectivePublicPermission(artifact, org) !== 'comment') {
					return yield* Effect.fail(new PublicCommentNotFoundError())
				}

				const guest = input.guestIdentity
				yield* tx.query(
					tx.client
						.insert(anonymousArtifactCommenters)
						.values({
							id: guest.anonymousAuthorId,
							artifact_id: input.artifactId,
							display_name: guest.guestName.trim(),
							email: guest.guestEmail?.trim() || null,
						})
						.onConflictDoNothing(),
				)
				const [stored] = yield* tx.query(
					tx.client
						.select()
						.from(anonymousArtifactCommenters)
						.where(
							and(
								eq(anonymousArtifactCommenters.id, guest.anonymousAuthorId),
								eq(anonymousArtifactCommenters.artifact_id, input.artifactId),
							),
						)
						.limit(1),
				)
				if (
					!stored ||
					normalized(stored.display_name) !== normalized(guest.guestName) ||
					normalized(stored.email ?? undefined) !== normalized(guest.guestEmail)
				) {
					return yield* Effect.fail(new GuestIdentityConflictError())
				}
				yield* tx.query(
					tx.client
						.update(anonymousArtifactCommenters)
						.set({ last_used_at: sql`now()` })
						.where(
							and(
								eq(anonymousArtifactCommenters.id, guest.anonymousAuthorId),
								eq(anonymousArtifactCommenters.artifact_id, input.artifactId),
							),
						),
				)

				const { commentId } = yield* insertThreadComment(tx, {
					artifact: { ...artifact, task_id: artifact.task_id },
					author: {
						kind: 'guest',
						anonymousAuthorId: guest.anonymousAuthorId,
						guestName: guest.guestName.trim(),
					},
					id: input.id,
					contentText: input.contentText.trim(),
					contentJson: input.contentJson,
					anchorJson: input.rootCommentId ? null : input.anchorJson,
					replyToCommentId: input.rootCommentId,
					rejectDeletedRoot: true,
					now: BigInt(now),
				}).pipe(
					Effect.catchTag('ArtifactCommentNotFound', () =>
						Effect.fail(new PublicCommentValidationError({ message: 'Comment thread is not available' })),
					),
				)
				const undoToken = randomBytes(32).toString('base64url')
				const undoExpiresAt = now + UNDO_LIFETIME_MS
				yield* tx.query(
					tx.client.insert(publicCommentUndoAuthorizations).values({
						comment_id: commentId,
						token_digest: createHash('sha256').update(undoToken).digest('hex'),
						expires_at: BigInt(undoExpiresAt),
					}),
				)
				return {
					commentId,
					transactionId: yield* getTransactionId(tx),
					success: true as const,
					undoToken,
					undoExpiresAt,
				}
			}),
		)
	})
}

interface UndoPublicCommentInput {
	artifactId: string
	shareKey: string
	commentId: string
	undoToken: string
}

function sameDigest(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left)
	const rightBuffer = Buffer.from(right)
	return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function undoPublicComment(input: UndoPublicCommentInput) {
	return Effect.gen(function* () {
		const db = yield* PostgresDb
		const now = BigInt(yield* Clock.currentTimeMillis)
		return yield* db.transaction((tx) =>
			Effect.gen(function* () {
				const [artifact] = yield* tx.query(
					tx.client.select().from(artifacts).where(eq(artifacts.id, input.artifactId)).limit(1).for('update'),
				)
				if (!artifact || artifact.share_key !== input.shareKey) {
					return yield* Effect.fail(new PublicCommentNotFoundError())
				}
				const org = yield* selectOrgPublicLinkPolicy(tx, artifact.organization_id)
				if (effectivePublicPermission(artifact, org) !== 'comment') {
					return yield* Effect.fail(new PublicCommentNotFoundError())
				}
				const [comment] = yield* tx.query(
					tx.client.select().from(artifactComments).where(eq(artifactComments.id, input.commentId)).limit(1),
				)
				const [authorization] = yield* tx.query(
					tx.client
						.select()
						.from(publicCommentUndoAuthorizations)
						.where(eq(publicCommentUndoAuthorizations.comment_id, input.commentId))
						.limit(1)
						.for('update'),
				)
				const submittedDigest = createHash('sha256').update(input.undoToken).digest('hex')
				if (
					!comment ||
					comment.artifact_id !== input.artifactId ||
					!comment.anonymous_author_id ||
					!comment.created_via_public_share ||
					!authorization ||
					authorization.expires_at < now ||
					!sameDigest(authorization.token_digest, submittedDigest)
				) {
					return yield* Effect.fail(new PublicCommentNotFoundError())
				}
				if (comment.reply_to_comment_id === null) {
					const [reply] = yield* tx.query(
						tx.client
							.select({ id: artifactComments.id })
							.from(artifactComments)
							.where(
								and(
									eq(artifactComments.reply_to_comment_id, comment.id),
									ne(artifactComments.is_deleted, true),
								),
							)
							.limit(1),
					)
					if (reply) {
						return yield* Effect.fail(
							new PublicCommentValidationError({ message: 'A comment with replies cannot be undone' }),
						)
					}
				}
				yield* tx.query(
					tx.client
						.update(artifactComments)
						.set({ is_deleted: true, updated_at: now })
						.where(eq(artifactComments.id, comment.id)),
				)
				yield* tx.query(
					tx.client
						.delete(publicCommentUndoAuthorizations)
						.where(eq(publicCommentUndoAuthorizations.comment_id, comment.id)),
				)
				return { commentId: comment.id, transactionId: yield* getTransactionId(tx), success: true as const }
			}),
		)
	})
}
