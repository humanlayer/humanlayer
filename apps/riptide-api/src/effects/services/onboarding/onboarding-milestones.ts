import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import type { PostgresDbQueryError } from '../postgres/postgres-db.errors'
import type { EffectPostgresDbService, PostgresTransaction } from '../postgres/postgres-db.service'
import type {
	PlanningArtifactIdentity,
	PlanningCommentEligibilityInput,
	RecordFirstInboundReviewCommentInput,
} from './onboarding-collaboration.schemas'

/**
 * Filenames / frontmatter types that mark an artifact as a design discussion.
 * The lite-sequence aha milestones (design-doc iterated, inbound comment
 * received/resolved) only fire for design-discussion artifacts.
 */
const DESIGN_DISCUSSION_FRONTMATTER_TYPE = 'design-discussion'

/**
 * Whether the artifact identified by `frontmatterType` / `fileName` is a
 * design-discussion artifact. Frontmatter type is the primary signal (the daemon
 * writes `type: design-discussion`); the filename is a cheap fallback for
 * artifacts written without frontmatter.
 */
export function isDesignDiscussionArtifact(input: PlanningArtifactIdentity): boolean {
	if (input.frontmatterType === DESIGN_DISCUSSION_FRONTMATTER_TYPE) return true
	const fileName = input.fileName?.toLowerCase() ?? ''
	return fileName.includes('design-discussion')
}

/**
 * Frontmatter types for the artifacts a teammate reviews and comments on: a
 * design discussion, a PRD, or a TDD. The inbound-comment milestones (received /
 * resolved) fire for any of these, not just design discussions.
 */
const DESIGN_REVIEW_FRONTMATTER_TYPES: ReadonlySet<string> = new Set([
	DESIGN_DISCUSSION_FRONTMATTER_TYPE,
	'design-prd',
	'design-tdd',
])

/**
 * Whether the artifact identified by `frontmatterType` / `fileName` is a
 * design-review artifact (design discussion, PRD, or TDD). Frontmatter type is
 * the primary signal (the RPI skills write `type: design-discussion` /
 * `design-prd` / `design-tdd`); the filename is a cheap fallback for artifacts
 * written without frontmatter. Strict superset of `isDesignDiscussionArtifact`,
 * so every artifact that qualified before still qualifies.
 */
export function isDesignReviewArtifact(input: PlanningArtifactIdentity): boolean {
	if (input.frontmatterType && DESIGN_REVIEW_FRONTMATTER_TYPES.has(input.frontmatterType)) return true
	const fileName = input.fileName?.toLowerCase() ?? ''
	return fileName.includes('design-discussion') || fileName.includes('prd') || fileName.includes('tdd')
}

/**
 * Proof query for the "design doc iterated" milestone.
 *
 * The PRD bar is "design discussion iterated — >=2 artifact versions". The
 * product stores the current content on the `artifacts` row and every prior
 * content state as an `artifact_versions` row, so "iterated to >=2 versions"
 * means there is at least one archived version (current + 1 archived = 2 states).
 *
 * The caller passes the `versionNumber` it just wrote (the archived version's
 * number, which is `(maxVersion ?? 0) + 1`). When that is >= 1 a version was
 * just created and the bar is already met, so the DB query is skipped. Otherwise
 * (no version created on this upsert) we count archived versions for the artifact.
 */
export function hasDesignDocIterated(
	db: EffectPostgresDbService,
	input: { artifactId: string; versionNumber?: number },
): Effect.Effect<boolean, PostgresDbQueryError> {
	if (input.versionNumber !== undefined && input.versionNumber >= 1) {
		return db.run(async () => true)
	}
	return db.run(async () => {
		const [row] = await db.client
			.select({ count: sql<number>`count(*)::int` })
			.from(artifactVersions)
			.where(eq(artifactVersions.artifact_id, input.artifactId))
			.limit(1)
		// >=1 archived version means current + at least one prior state = >=2 versions.
		return (row?.count ?? 0) >= 1
	})
}

/**
 * Frontmatter type / filename markers for a structure-outline artifact. The
 * day-7 full-sequence slot fires once a user has produced a structure outline.
 */
const STRUCTURE_OUTLINE_FRONTMATTER_TYPE = 'structure-outline'

/**
 * Whether the artifact identified by `frontmatterType` / `fileName` is a
 * structure-outline artifact. Frontmatter type is the primary signal (the
 * create-structure-outline skill writes `type: structure-outline`); the filename
 * is a cheap fallback for artifacts written without frontmatter.
 */
export function isStructureOutlineArtifact(input: PlanningArtifactIdentity): boolean {
	if (input.frontmatterType === STRUCTURE_OUTLINE_FRONTMATTER_TYPE) return true
	const fileName = input.fileName?.toLowerCase() ?? ''
	return fileName.includes('structure-outline')
}

/**
 * Whether the artifact identified by `fileName` is a pr-description artifact.
 * The describe-pr skill writes `pr-description.md` with no frontmatter `type`, so
 * the filename is the only reliable signal. Reaching a written pr-description is
 * the proof that the implementation completed (day-10 "complete" milestone).
 */
export function isPrDescriptionArtifact(input: { fileName?: string | null }): boolean {
	const fileName = input.fileName?.toLowerCase() ?? ''
	return fileName.includes('pr-description')
}

/**
 * The session label that marks a running/started implementation. The day-10
 * "implementation started" milestone fires once at least one session carries it.
 */
const IMPLEMENTATION_LABEL_NAME = 'rpi:implementation'

/**
 * Whether any of the supplied session labels is the implementation label. The
 * caller passes the labels it just appended/created (daemon event-label append or
 * auto-advance launch), so this is a cheap in-memory check with no DB query.
 */
export function hasImplementationLabel(labels: ReadonlyArray<{ name: string }> | undefined | null): boolean {
	if (!labels) return false
	return labels.some((label) => label.name === IMPLEMENTATION_LABEL_NAME)
}

/**
 * Proof query for the inbound-comment milestones: confirm the commented-on
 * artifact is a design-review artifact (design discussion, PRD, or TDD). The
 * caller already supplied direction (`ownerUserId !== commenterUserId`) and
 * human/agent context, so the only thing the service cannot cheaply know is the
 * artifact's frontmatter/filename.
 */
export function isDesignReviewArtifactById(
	db: EffectPostgresDbService,
	input: { artifactId: string },
): Effect.Effect<boolean, PostgresDbQueryError> {
	return db.run(async () => {
		const [row] = await db.client
			.select({ frontmatter: artifacts.frontmatter, fileName: artifacts.file_name })
			.from(artifacts)
			.where(and(eq(artifacts.id, input.artifactId), eq(artifacts.is_deleted, false)))
			.limit(1)
		if (!row) return false
		const frontmatterType = typeof row.frontmatter?.type === 'string' ? (row.frontmatter.type as string) : undefined
		return isDesignReviewArtifact({ frontmatterType, fileName: row.fileName })
	})
}

/**
 * Whether a comment counts as cross-user human feedback: a real person (not an
 * agent) commenting on someone else's doc. Agent comments and self-comments
 * never advance the inbound/outbound comment milestones. Shared by the in-tx
 * checklist write and the post-commit Resend milestones so the direction rule
 * lives in one place.
 */
export function isCrossUserHumanComment(input: {
	createdByAgent: boolean
	ownerUserId: string
	commenterUserId: string
}): boolean {
	return !input.createdByAgent && input.ownerUserId !== input.commenterUserId
}

/** The checklist rule is intentionally broader than the human-only email campaign rule. */
export function isPlanningCollaborationComment(input: PlanningCommentEligibilityInput): boolean {
	return (
		input.ownerUserId !== input.commenterUserId &&
		(isDesignReviewArtifact(input) || isStructureOutlineArtifact(input))
	)
}

/**
 * Persist the onboarding-checklist `first_inbound_comment_received_at` milestone
 * (distinct from the Resend `design_doc_inbound_comment_received` campaign
 * milestone). Written inside the comment-creation transaction — atomic with the
 * comment insert, matching the sibling `first_*` milestone columns and letting
 * the checklist read it back without a race. No-op unless another user's human
 * or agent comment targets the owner's planning artifact; write-once via the
 * `is null` guard, so an already-earned milestone is never moved.
 */
export function recordFirstInboundReviewComment(
	tx: PostgresTransaction,
	input: RecordFirstInboundReviewCommentInput,
): Effect.Effect<void, PostgresDbQueryError> {
	if (!isPlanningCollaborationComment(input)) return Effect.void
	return tx
		.query(
			tx.client
				.insert(userSettings)
				.values({
					user_id: input.ownerUserId,
					organization_id: input.organizationId,
					first_inbound_comment_received_at: input.now,
				})
				.onConflictDoUpdate({
					target: [userSettings.user_id, userSettings.organization_id],
					set: { first_inbound_comment_received_at: input.now, updated_at: input.now },
					where: isNull(userSettings.first_inbound_comment_received_at),
				}),
		)
		.pipe(Effect.asVoid)
}
