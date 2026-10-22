import { describe, it } from '@effect/vitest'
import { artifactComments as artifactCommentRows } from '@humanlayer/db/tables/artifact-comments'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, expect } from 'vitest'

import { ArtifactComments } from '../../src/effects/services/artifact-comments/artifact-comments'
import { ArtifactCommentsLive } from '../../src/effects/services/artifact-comments/artifact-comments-live'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import {
	createTestOnboardingLayer,
	defaultTestWorkosLayer,
	fakeSlackLayer,
} from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('ArtifactComments', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let taskId: string
	let artifactId: string
	let planningArtifactId: string
	const userId = 'artifact-comments-effect-user'
	const artifactOwnerUserId = 'artifact-comments-plan-owner'
	const reviewerUserId = 'artifact-comments-plan-reviewer'

	beforeAll(async () => {
		const testDb = await createTestDb('artifact_comments_effect')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		const [organization] = await db
			.insert(organizations)
			.values({
				name: 'Artifact Comments Effect Tests',
				workos_organization_id: 'workos-artifact-comments-effect',
			})
			.returning()
		if (!organization) throw new Error('Failed to seed organization')
		organizationId = organization.id
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Artifact comments effect task',
				created_by: userId,
				resource_owner_user_id: userId,
			})
			.returning()
		if (!task) throw new Error('Failed to seed task')
		taskId = task.id
		const [artifact] = await db
			.insert(artifacts)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				task_id: taskId,
				file_name: 'effect-test.md',
				content: '# Effect test',
				content_hash: 'effect-test-hash',
				created_by: userId,
			})
			.returning()
		if (!artifact) throw new Error('Failed to seed artifact')
		artifactId = artifact.id
		const [planningArtifact] = await db
			.insert(artifacts)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: artifactOwnerUserId,
				task_id: taskId,
				file_name: '05-structure-outline-plan.md',
				frontmatter: { type: 'structure-outline' },
				content: '# Plan',
				content_hash: 'plan-hash',
				created_by: userId,
			})
			.returning()
		if (!planningArtifact) throw new Error('Failed to seed planning artifact')
		planningArtifactId = planningArtifact.id
		await db.insert(taskUserAcl).values(
			[artifactOwnerUserId, reviewerUserId].map((subjectUserId) => ({
				task_id: taskId,
				subject_user_id: subjectUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'comment' as const,
				granted_by: userId,
			})),
		)
	}, 60_000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30_000)

	const makeLayer = () => {
		const dependencies = Layer.mergeAll(
			PostgresDbLive(db),
			defaultTestWorkosLayer,
			createTestOnboardingLayer(db),
			fakeSlackLayer,
		)
		return Layer.provideMerge(ArtifactCommentsLive, dependencies)
	}

	it.effect('returns post-commit context and root-normalizes a reply', () =>
		Effect.gen(function* () {
			const artifactComments = yield* ArtifactComments
			const userInfo = { organizationId, userId, createdByAgent: false }
			const root = yield* artifactComments.create({
				artifactId,
				contentText: 'Artifact feedback',
				userInfo,
			})
			const reply = yield* artifactComments.reply({
				taskId,
				artifactFilename: 'effect-test.md',
				truncatedCommentId: root.commentId.slice(-12),
				contentText: 'Artifact reply',
				userInfo,
			})
			const rows = yield* Effect.promise(() =>
				db.select().from(artifactCommentRows).where(eq(artifactCommentRows.artifact_id, artifactId)),
			)
			expect(root.postCommitContext).toMatchObject({ artifactId, taskId, ownerUserId: userId })
			expect(reply.parentCommentId).toBe(root.commentId)
			expect(rows.find((row) => row.id === reply.commentId)?.reply_to_comment_id).toBe(root.commentId)
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('records human create and agent reply collaboration for the artifact owner', () =>
		Effect.gen(function* () {
			const artifactComments = yield* ArtifactComments
			const humanComment = yield* artifactComments.create({
				artifactId: planningArtifactId,
				contentText: 'Human review',
				userInfo: { organizationId, userId: reviewerUserId, createdByAgent: false },
			})
			let [settings] = yield* Effect.promise(() =>
				db.select().from(userSettings).where(eq(userSettings.user_id, artifactOwnerUserId)),
			)
			expect(settings?.first_inbound_comment_received_at).not.toBeNull()
			const firstTimestamp = settings?.first_inbound_comment_received_at

			// The writer is null-guarded: a later comment cannot move the earned timestamp.
			yield* artifactComments.create({
				artifactId: planningArtifactId,
				contentText: 'Another review',
				userInfo: { organizationId, userId: reviewerUserId, createdByAgent: false },
			})
			;[settings] = yield* Effect.promise(() =>
				db.select().from(userSettings).where(eq(userSettings.user_id, artifactOwnerUserId)),
			)
			expect(settings?.first_inbound_comment_received_at).toBe(firstTimestamp)

			yield* Effect.promise(() =>
				db
					.update(userSettings)
					.set({ first_inbound_comment_received_at: null })
					.where(eq(userSettings.user_id, artifactOwnerUserId)),
			)
			const ownerRoot = yield* artifactComments.create({
				artifactId: planningArtifactId,
				contentText: 'Owner root',
				userInfo: { organizationId, userId: artifactOwnerUserId, createdByAgent: true },
			})
			;[settings] = yield* Effect.promise(() =>
				db.select().from(userSettings).where(eq(userSettings.user_id, artifactOwnerUserId)),
			)
			expect(settings?.first_inbound_comment_received_at).toBeNull()

			const agentReply = yield* artifactComments.reply({
				taskId,
				artifactFilename: '05-structure-outline-plan.md',
				truncatedCommentId: ownerRoot.commentId.slice(-12),
				contentText: 'Agent review',
				userInfo: { organizationId, userId: reviewerUserId, createdByAgent: true },
			})
			;[settings] = yield* Effect.promise(() =>
				db.select().from(userSettings).where(eq(userSettings.user_id, artifactOwnerUserId)),
			)
			expect(agentReply.parentCommentId).toBe(ownerRoot.commentId)
			expect(settings?.first_inbound_comment_received_at).not.toBeNull()
			expect(humanComment.postCommitContext.ownerUserId).toBe(userId)
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect(
		'covers every planning identity, comment kind, and human or agent identity without marking self feedback',
		() =>
			Effect.gen(function* () {
				const artifactComments = yield* ArtifactComments
				const cases = [
					{ frontmatter: { type: 'design-discussion' }, fileName: 'discussion.md', kind: 'comment' as const },
					{ frontmatter: { type: 'design-prd' }, fileName: 'prd.md', kind: 'deletion' as const },
					{ frontmatter: { type: 'design-tdd' }, fileName: 'tdd.md', kind: 'approval' as const },
					{ frontmatter: { type: 'structure-outline' }, fileName: 'outline.md', kind: 'comment' as const },
					{ frontmatter: {}, fileName: '02-design-discussion-legacy.md', kind: 'deletion' as const },
					{ frontmatter: {}, fileName: '03-prd-legacy.md', kind: 'approval' as const },
					{ frontmatter: {}, fileName: '04-tdd-legacy.md', kind: 'comment' as const },
					{ frontmatter: {}, fileName: '05-structure-outline-legacy.md', kind: 'approval' as const },
				]
				const seeded = yield* Effect.promise(() =>
					db
						.insert(artifacts)
						.values(
							cases.map((testCase, index) => ({
								organization_id: organizationId,
								task_id: taskId,
								resource_owner_user_id: `planning-matrix-owner-${index}`,
								created_by: `planning-matrix-creator-${index}`,
								file_name: testCase.fileName,
								frontmatter: testCase.frontmatter,
								content: '# Planning matrix',
								content_hash: `planning-matrix-${index}`,
							})),
						)
						.returning(),
				)
				yield* Effect.promise(() =>
					db.insert(taskUserAcl).values(
						cases.map((_, index) => ({
							task_id: taskId,
							subject_user_id: `planning-matrix-owner-${index}`,
							organization_id: organizationId,
							resource_owner_user_id: userId,
							permission_level: 'comment' as const,
							granted_by: userId,
						})),
					),
				)

				for (const [index, artifact] of seeded.entries()) {
					const ownerUserId = `planning-matrix-owner-${index}`
					const selfComment = yield* artifactComments.create({
						artifactId: artifact.id,
						contentText: 'Owner feedback must not qualify',
						kind: cases[index]?.kind,
						userInfo: { organizationId, userId: ownerUserId, createdByAgent: index % 2 === 0 },
					})
					let [settings] = yield* Effect.promise(() =>
						db.select().from(userSettings).where(eq(userSettings.user_id, ownerUserId)),
					)
					expect(settings).toBeUndefined()
					expect(selfComment.postCommitContext.ownerUserId).toBe(userId)

					const crossUserComment = yield* artifactComments.create({
						artifactId: artifact.id,
						contentText: 'Cross-user feedback qualifies',
						kind: cases[index]?.kind,
						userInfo: { organizationId, userId: reviewerUserId, createdByAgent: index % 2 === 1 },
					})
					;[settings] = yield* Effect.promise(() =>
						db.select().from(userSettings).where(eq(userSettings.user_id, ownerUserId)),
					)
					expect(settings?.first_inbound_comment_received_at).not.toBeNull()
					const [stored] = yield* Effect.promise(() =>
						db
							.select()
							.from(artifactCommentRows)
							.where(eq(artifactCommentRows.id, crossUserComment.commentId)),
					)
					expect(stored).toMatchObject({
						artifact_id: artifact.id,
						created_by_user_id: reviewerUserId,
						created_by_agent: index % 2 === 1,
						kind: cases[index]?.kind,
					})
				}
			}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('rolls back root creation, replies, and thread reopening when the milestone write fails', () =>
		Effect.gen(function* () {
			const artifactComments = yield* ArtifactComments
			const root = yield* artifactComments.create({
				artifactId: planningArtifactId,
				contentText: 'Resolved owner thread',
				userInfo: { organizationId, userId: artifactOwnerUserId, createdByAgent: false },
			})
			yield* Effect.promise(() =>
				db
					.update(userSettings)
					.set({ first_inbound_comment_received_at: null })
					.where(eq(userSettings.user_id, artifactOwnerUserId)),
			)
			yield* Effect.promise(() =>
				db
					.update(artifactCommentRows)
					.set({ is_resolved: true })
					.where(eq(artifactCommentRows.id, root.commentId)),
			)

			yield* Effect.acquireUseRelease(
				Effect.promise(async () => {
					await db.execute(sql`
						CREATE FUNCTION reject_collaboration_milestone_for_test() RETURNS trigger AS $$
						BEGIN RAISE EXCEPTION 'test milestone rejection'; END;
						$$ LANGUAGE plpgsql
					`)
					await db.execute(sql`
						CREATE TRIGGER reject_collaboration_milestone_for_test
						BEFORE INSERT OR UPDATE ON user_settings
						FOR EACH ROW WHEN (NEW.user_id = 'artifact-comments-plan-owner')
						EXECUTE FUNCTION reject_collaboration_milestone_for_test()
					`)
				}),
				() =>
					Effect.gen(function* () {
						const beforeRows = yield* Effect.promise(() =>
							db
								.select()
								.from(artifactCommentRows)
								.where(eq(artifactCommentRows.artifact_id, planningArtifactId)),
						)
						const createFailure = yield* artifactComments
							.create({
								artifactId: planningArtifactId,
								contentText: 'Root must roll back',
								userInfo: { organizationId, userId: reviewerUserId, createdByAgent: false },
							})
							.pipe(Effect.flip)
						expect(createFailure._tag).toBe('ArtifactCommentsUnavailable')
						const replyFailure = yield* artifactComments
							.reply({
								taskId,
								artifactFilename: '05-structure-outline-plan.md',
								truncatedCommentId: root.commentId.slice(-12),
								contentText: 'Reply must roll back',
								userInfo: { organizationId, userId: reviewerUserId, createdByAgent: true },
							})
							.pipe(Effect.flip)
						expect(replyFailure._tag).toBe('ArtifactCommentsUnavailable')
						const afterRows = yield* Effect.promise(() =>
							db
								.select()
								.from(artifactCommentRows)
								.where(eq(artifactCommentRows.artifact_id, planningArtifactId)),
						)
						expect(afterRows).toHaveLength(beforeRows.length)
						expect(afterRows.find((row) => row.id === root.commentId)?.is_resolved).toBe(true)
						const [settings] = yield* Effect.promise(() =>
							db.select().from(userSettings).where(eq(userSettings.user_id, artifactOwnerUserId)),
						)
						expect(settings?.first_inbound_comment_received_at).toBeNull()
					}),
				() =>
					Effect.promise(async () => {
						await db.execute(
							sql`DROP TRIGGER IF EXISTS reject_collaboration_milestone_for_test ON user_settings`,
						)
						await db.execute(sql`DROP FUNCTION IF EXISTS reject_collaboration_milestone_for_test()`)
					}),
			)
		}).pipe(Effect.provide(makeLayer())),
	)
})
