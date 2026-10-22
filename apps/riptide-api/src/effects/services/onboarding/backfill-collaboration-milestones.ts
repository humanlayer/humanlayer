import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { artifactMetadataSelectSchema, artifacts } from '@humanlayer/db/tables/artifacts'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import * as Sentry from '@sentry/node'
import { and, asc, eq, gt, isNull, ne, or } from 'drizzle-orm'
import { Effect, Match, Schema } from 'effect'

import type { PostgresDbQueryError } from '../postgres/postgres-db.errors'
import { PostgresDb, type EffectPostgresDbService } from '../postgres/postgres-db.service'
import {
	BackfillCollaborationMilestonesInput,
	CollaborationBackfillCandidate,
	CollaborationBackfillIncompleteVerification,
	CollaborationBackfillInvalidInput,
	CollaborationBackfillInvalidStoredMetadata,
	CollaborationBackfillOwnerCursor,
	CollaborationBackfillPersistenceUnavailable,
	CollaborationBackfillSummary,
	type CollaborationBackfillTarget,
} from './onboarding-collaboration.schemas'
import { isPlanningCollaborationComment } from './onboarding-milestones'

const OWNER_PAGE_SIZE = 100
const COMMENT_PAGE_SIZE = 500

const matchTarget = Match.type<CollaborationBackfillTarget>().pipe(
	Match.tagsExhaustive({
		Organization: ({ organizationId }) => organizationId,
		AllOrganizations: () => undefined,
	}),
)

function capturePersistenceFailure(operation: string, error: PostgresDbQueryError) {
	return Effect.logError('Collaboration milestone backfill persistence failed', error).pipe(
		Effect.annotateLogs({ operation, retryable: error.retryable }),
		Effect.andThen(Effect.sync(() => Sentry.captureException(error, { tags: { operation } }))),
	)
}

function narrowPersistenceFailure<A>(operation: string, effect: Effect.Effect<A, PostgresDbQueryError>) {
	return effect.pipe(
		Effect.tapError((error) => capturePersistenceFailure(operation, error)),
		Effect.mapError(
			(error) => new CollaborationBackfillPersistenceUnavailable({ operation, retryable: error.retryable }),
		),
	)
}

function listOwnerCandidates(
	db: EffectPostgresDbService,
	target: CollaborationBackfillTarget,
	cursor?: CollaborationBackfillOwnerCursor,
) {
	const organizationId = matchTarget(target)
	const targetFilter = organizationId === undefined ? undefined : eq(artifacts.organization_id, organizationId)
	const cursorFilter = cursor
		? or(
				gt(artifacts.organization_id, cursor.organizationId),
				and(
					eq(artifacts.organization_id, cursor.organizationId),
					gt(artifacts.resource_owner_user_id, cursor.ownerUserId),
				),
			)
		: undefined

	return narrowPersistenceFailure(
		'onboarding.backfill.list_owner_candidates',
		db.query(
			db.client
				.selectDistinct({
					organizationId: artifacts.organization_id,
					ownerUserId: artifacts.resource_owner_user_id,
				})
				.from(artifactComments)
				.innerJoin(artifacts, eq(artifactComments.artifact_id, artifacts.id))
				.where(
					and(
						ne(artifactComments.created_by_user_id, artifacts.resource_owner_user_id),
						targetFilter,
						cursorFilter,
					),
				)
				.orderBy(asc(artifacts.organization_id), asc(artifacts.resource_owner_user_id))
				.limit(OWNER_PAGE_SIZE),
		),
	).pipe(
		Effect.flatMap((rows) =>
			Schema.decodeUnknownEffect(Schema.Array(CollaborationBackfillCandidate))(rows).pipe(
				Effect.mapError(
					() => new CollaborationBackfillInvalidStoredMetadata({ artifactId: 'owner-candidate-page' }),
				),
			),
		),
	)
}

function findEarliestQualifyingComment(db: EffectPostgresDbService, candidate: CollaborationBackfillCandidate) {
	return Effect.gen(function* () {
		let cursor: { createdAt: bigint; id: string } | undefined
		let earliest: bigint | undefined

		while (true) {
			const cursorFilter = cursor
				? or(
						gt(artifactComments.created_at, cursor.createdAt),
						and(eq(artifactComments.created_at, cursor.createdAt), gt(artifactComments.id, cursor.id)),
					)
				: undefined
			const rows = yield* narrowPersistenceFailure(
				'onboarding.backfill.scan_owner_comments',
				db.query(
					db.client
						.select({
							id: artifactComments.id,
							artifactId: artifacts.id,
							commenterUserId: artifactComments.created_by_user_id,
							createdAt: artifactComments.created_at,
							frontmatter: artifacts.frontmatter,
							fileName: artifacts.file_name,
						})
						.from(artifactComments)
						.innerJoin(artifacts, eq(artifactComments.artifact_id, artifacts.id))
						.where(
							and(
								eq(artifacts.organization_id, candidate.organizationId),
								eq(artifacts.resource_owner_user_id, candidate.ownerUserId),
								ne(artifactComments.created_by_user_id, candidate.ownerUserId),
								cursorFilter,
							),
						)
						.orderBy(asc(artifactComments.created_at), asc(artifactComments.id))
						.limit(COMMENT_PAGE_SIZE),
				),
			)

			for (const row of rows) {
				if (!row.commenterUserId) continue
				const parsedFrontmatter = artifactMetadataSelectSchema.shape.frontmatter.safeParse(row.frontmatter)
				if (!parsedFrontmatter.success) {
					yield* Effect.logError('Invalid artifact frontmatter during collaboration backfill').pipe(
						Effect.annotateLogs({ artifactId: row.artifactId }),
						Effect.andThen(
							Effect.sync(() =>
								Sentry.captureException(parsedFrontmatter.error, {
									tags: { operation: 'onboarding.backfill.decode_frontmatter' },
									extra: { artifactId: row.artifactId },
								}),
							),
						),
					)
					return yield* new CollaborationBackfillInvalidStoredMetadata({ artifactId: row.artifactId })
				}
				const frontmatterType = parsedFrontmatter.data.type
				if (
					isPlanningCollaborationComment({
						ownerUserId: candidate.ownerUserId,
						commenterUserId: row.commenterUserId,
						frontmatterType: typeof frontmatterType === 'string' ? frontmatterType : undefined,
						fileName: row.fileName,
					})
				) {
					earliest = earliest === undefined || row.createdAt < earliest ? row.createdAt : earliest
				}
			}

			if (rows.length < COMMENT_PAGE_SIZE) return earliest
			const last = rows.at(-1)
			if (!last) return earliest
			cursor = { createdAt: last.createdAt, id: last.id }
		}
	}).pipe(
		Effect.withSpan('onboarding.backfill.scan_owner', {
			attributes: {
				organizationId: candidate.organizationId,
				ownerUserId: candidate.ownerUserId,
			},
		}),
	)
}

function writeRecoveredTimestamp(
	db: EffectPostgresDbService,
	candidate: CollaborationBackfillCandidate,
	timestamp: bigint,
) {
	return narrowPersistenceFailure(
		'onboarding.backfill.write_owner_timestamp',
		db
			.query(
				db.client
					.insert(userSettings)
					.values({
						user_id: candidate.ownerUserId,
						organization_id: candidate.organizationId,
						first_inbound_comment_received_at: timestamp,
						updated_at: timestamp,
					})
					.onConflictDoUpdate({
						target: [userSettings.user_id, userSettings.organization_id],
						set: { first_inbound_comment_received_at: timestamp, updated_at: timestamp },
						where: isNull(userSettings.first_inbound_comment_received_at),
					})
					.returning({ userId: userSettings.user_id }),
			)
			.pipe(Effect.map((rows) => rows.length === 1)),
	)
}

function hasRecoveredTimestamp(db: EffectPostgresDbService, candidate: CollaborationBackfillCandidate) {
	return narrowPersistenceFailure(
		'onboarding.backfill.verify_owner_timestamp',
		db
			.query(
				db.client
					.select({ timestamp: userSettings.first_inbound_comment_received_at })
					.from(userSettings)
					.where(
						and(
							eq(userSettings.organization_id, candidate.organizationId),
							eq(userSettings.user_id, candidate.ownerUserId),
						),
					)
					.limit(1),
			)
			.pipe(Effect.map((rows) => rows[0]?.timestamp != null)),
	)
}

function visitAllCandidateOwners<E, R>(
	db: EffectPostgresDbService,
	target: CollaborationBackfillTarget,
	visit: (candidate: CollaborationBackfillCandidate) => Effect.Effect<void, E, R>,
) {
	return Effect.gen(function* () {
		let cursor: CollaborationBackfillOwnerCursor | undefined
		while (true) {
			const candidates = yield* listOwnerCandidates(db, target, cursor)
			for (const candidate of candidates) yield* visit(candidate)
			if (candidates.length < OWNER_PAGE_SIZE) return
			const last = candidates.at(-1)
			if (!last) return
			cursor = CollaborationBackfillOwnerCursor.make(last)
		}
	})
}

/** Recovers the owner's write-once collaboration milestone from persisted historical comments. */
export const backfillCollaborationMilestones = Effect.fn('onboarding.backfillCollaborationMilestones')(function* (
	rawInput: unknown,
) {
	const input = yield* Schema.decodeUnknownEffect(BackfillCollaborationMilestonesInput)(rawInput).pipe(
		Effect.mapError(() => new CollaborationBackfillInvalidInput({ message: 'Invalid backfill input' })),
	)
	const db = yield* PostgresDb
	let ownersChecked = 0
	let ownersWithQualifyingFeedback = 0
	let settingsRowsChanged = 0

	yield* visitAllCandidateOwners(db, input.target, (candidate) =>
		Effect.gen(function* () {
			ownersChecked += 1
			const earliest = yield* findEarliestQualifyingComment(db, candidate)
			if (earliest === undefined) return
			ownersWithQualifyingFeedback += 1
			if (input.apply && (yield* writeRecoveredTimestamp(db, candidate, earliest))) settingsRowsChanged += 1
		}),
	)

	if (input.apply) {
		let remainingOwnerCount = 0
		yield* visitAllCandidateOwners(db, input.target, (candidate) =>
			Effect.gen(function* () {
				const earliest = yield* findEarliestQualifyingComment(db, candidate)
				if (earliest !== undefined && !(yield* hasRecoveredTimestamp(db, candidate))) {
					remainingOwnerCount += 1
				}
			}),
		).pipe(Effect.withSpan('onboarding.backfill.verify_completeness'))
		if (remainingOwnerCount > 0) {
			return yield* new CollaborationBackfillIncompleteVerification({ remainingOwnerCount })
		}
	}

	return CollaborationBackfillSummary.make({
		ownersChecked,
		ownersWithQualifyingFeedback,
		settingsRowsChanged,
		failed: false,
	})
})
