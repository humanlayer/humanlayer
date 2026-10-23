import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Deferred, Effect, Fiber } from 'effect'
import { afterAll, beforeAll, expect } from 'vitest'

import { backfillCollaborationMilestones } from '../../src/effects/services/onboarding/backfill-collaboration-milestones'
import { CollaborationBackfillTarget } from '../../src/effects/services/onboarding/onboarding-collaboration.schemas'
import { recordFirstInboundReviewComment } from '../../src/effects/services/onboarding/onboarding-milestones'
import { PostgresDb, PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('backfillCollaborationMilestones', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationA: string
	let organizationB: string
	let taskA: string
	let taskB: string

	beforeAll(async () => {
		const testDb = await createTestDb('collaboration_backfill')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		const seededOrganizations = await db
			.insert(organizations)
			.values([
				{ name: 'Backfill A', workos_organization_id: 'workos-backfill-a' },
				{ name: 'Backfill B', workos_organization_id: 'workos-backfill-b' },
			])
			.returning()
		const [orgA, orgB] = seededOrganizations
		if (!orgA || !orgB) throw new Error('Failed to seed backfill organizations')
		organizationA = orgA.id
		organizationB = orgB.id
		const seededTasks = await db
			.insert(tasks)
			.values([
				{
					organization_id: organizationA,
					name: 'Backfill task A',
					created_by: 'task-owner-a',
					resource_owner_user_id: 'task-owner-a',
				},
				{
					organization_id: organizationB,
					name: 'Backfill task B',
					created_by: 'task-owner-b',
					resource_owner_user_id: 'task-owner-b',
				},
			])
			.returning()
		const [seededTaskA, seededTaskB] = seededTasks
		if (!seededTaskA || !seededTaskB) throw new Error('Failed to seed backfill tasks')
		taskA = seededTaskA.id
		taskB = seededTaskB.id
	}, 60_000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30_000)

	const run = (organizationId: string, apply: boolean) =>
		backfillCollaborationMilestones({
			target: CollaborationBackfillTarget.cases.Organization.make({ organizationId }),
			apply,
		}).pipe(Effect.provide(PostgresDbLive(db)))

	it.effect('previews immutably, applies historical minima, isolates organizations, and reruns safely', () =>
		Effect.gen(function* () {
			const ownerA = 'historical-owner-a'
			const preservedOwnerA = 'preserved-owner-a'
			const ownerB = 'historical-owner-b'
			const [eligibleA, preservedA, ineligibleA, eligibleB] = yield* Effect.promise(() =>
				db
					.insert(artifacts)
					.values([
						{
							organization_id: organizationA,
							task_id: taskA,
							resource_owner_user_id: ownerA,
							created_by: 'creator-different-from-owner',
							file_name: 'legacy-structure-outline.md',
							frontmatter: {},
							content: '# Historical plan',
							content_hash: 'historical-a',
							is_deleted: true,
						},
						{
							organization_id: organizationA,
							task_id: taskA,
							resource_owner_user_id: preservedOwnerA,
							created_by: preservedOwnerA,
							file_name: '03-prd-preserved.md',
							content: '# Preserved',
							content_hash: 'preserved-a',
						},
						{
							organization_id: organizationA,
							task_id: taskA,
							resource_owner_user_id: 'ineligible-owner-a',
							created_by: 'ineligible-owner-a',
							file_name: 'notes.md',
							content: '# Notes',
							content_hash: 'ineligible-a',
						},
						{
							organization_id: organizationB,
							task_id: taskB,
							resource_owner_user_id: ownerB,
							created_by: ownerB,
							file_name: 'design.md',
							frontmatter: { type: 'design-tdd' },
							content: '# B',
							content_hash: 'historical-b',
						},
					])
					.returning(),
			)
			if (!eligibleA || !preservedA || !ineligibleA || !eligibleB) return yield* Effect.die('seed failed')
			const historicalRootId = randomUUID()
			yield* Effect.promise(() =>
				db.insert(artifactComments).values([
					{
						id: historicalRootId,
						organization_id: organizationA,
						resource_owner_user_id: ownerA,
						task_id: taskA,
						created_by_user_id: 'reviewer-a',
						artifact_id: eligibleA.id,
						content_text: 'Resolved historical agent review',
						created_by_agent: true,
						kind: 'approval',
						is_resolved: true,
						is_deleted: true,
						created_at: 100n,
						updated_at: 100n,
					},
					{
						organization_id: organizationA,
						resource_owner_user_id: ownerA,
						task_id: taskA,
						created_by_user_id: 'reviewer-a',
						artifact_id: eligibleA.id,
						reply_to_comment_id: historicalRootId,
						content_text: 'Historical deletion reply',
						kind: 'deletion',
						created_at: 150n,
						updated_at: 150n,
					},
					{
						organization_id: organizationA,
						resource_owner_user_id: preservedOwnerA,
						task_id: taskA,
						created_by_user_id: 'reviewer-a',
						artifact_id: preservedA.id,
						content_text: 'Preserved review',
						created_at: 200n,
						updated_at: 200n,
					},
					{
						organization_id: organizationA,
						resource_owner_user_id: 'ineligible-owner-a',
						task_id: taskA,
						created_by_user_id: 'reviewer-a',
						artifact_id: ineligibleA.id,
						content_text: 'Not a plan',
						created_at: 50n,
						updated_at: 50n,
					},
					{
						organization_id: organizationB,
						resource_owner_user_id: ownerB,
						task_id: taskB,
						created_by_user_id: 'reviewer-b',
						artifact_id: eligibleB.id,
						content_text: 'Other org',
						created_at: 75n,
						updated_at: 75n,
					},
				]),
			)
			yield* Effect.promise(() =>
				db.insert(userSettings).values({
					user_id: preservedOwnerA,
					organization_id: organizationA,
					theme: 'monokai',
					first_inbound_comment_received_at: 25n,
				}),
			)

			const before = yield* Effect.promise(() => db.select().from(userSettings))
			const preview = yield* run(organizationA, false)
			const afterPreview = yield* Effect.promise(() => db.select().from(userSettings))
			expect(preview).toMatchObject({
				ownersChecked: 3,
				ownersWithQualifyingFeedback: 2,
				settingsRowsChanged: 0,
				failed: false,
			})
			expect(afterPreview).toEqual(before)

			const applied = yield* run(organizationA, true)
			expect(applied.settingsRowsChanged).toBe(1)
			const rows = yield* Effect.promise(() => db.select().from(userSettings))
			expect(
				rows.find((row) => row.user_id === ownerA && row.organization_id === organizationA)
					?.first_inbound_comment_received_at,
			).toBe(100n)
			expect(rows.find((row) => row.user_id === preservedOwnerA)?.first_inbound_comment_received_at).toBe(25n)
			expect(rows.find((row) => row.user_id === preservedOwnerA)?.theme).toBe('monokai')
			expect(rows.some((row) => row.user_id === ownerB)).toBe(false)

			const rerun = yield* run(organizationA, true)
			expect(rerun.settingsRowsChanged).toBe(0)
		}).pipe(Effect.provide(PostgresDbLive(db))),
	)

	it.effect('processes more than one bounded owner page', () =>
		Effect.gen(function* () {
			const [organization] = yield* Effect.promise(() =>
				db
					.insert(organizations)
					.values({
						name: 'Backfill owner paging',
						workos_organization_id: `workos-owner-page-${randomUUID()}`,
					})
					.returning(),
			)
			if (!organization) return yield* Effect.die('organization seed failed')
			const [task] = yield* Effect.promise(() =>
				db
					.insert(tasks)
					.values({
						organization_id: organization.id,
						name: 'Owner paging task',
						created_by: 'owner-page-task-owner',
						resource_owner_user_id: 'owner-page-task-owner',
					})
					.returning(),
			)
			if (!task) return yield* Effect.die('task seed failed')
			const pagedArtifacts = yield* Effect.promise(() =>
				db
					.insert(artifacts)
					.values(
						Array.from({ length: 101 }, (_, index) => ({
							organization_id: organization.id,
							task_id: task.id,
							resource_owner_user_id: `owner-page-${index.toString().padStart(3, '0')}`,
							created_by: 'owner-page-creator',
							file_name: `03-prd-owner-page-${index}.md`,
							content: '# Owner page',
							content_hash: `owner-page-${index}`,
						})),
					)
					.returning(),
			)
			yield* Effect.promise(() =>
				db.insert(artifactComments).values(
					pagedArtifacts.map((artifact, index) => ({
						organization_id: organization.id,
						resource_owner_user_id: `owner-page-${index.toString().padStart(3, '0')}`,
						task_id: task.id,
						created_by_user_id: 'owner-page-reviewer',
						artifact_id: artifact.id,
						content_text: 'Paged owner review',
						created_at: BigInt(index + 1),
						updated_at: BigInt(index + 1),
					})),
				),
			)

			const preview = yield* run(organization.id, false)
			expect(preview).toMatchObject({
				ownersChecked: 101,
				ownersWithQualifyingFeedback: 101,
				settingsRowsChanged: 0,
				failed: false,
			})
		}).pipe(Effect.provide(PostgresDbLive(db))),
	)

	it.effect('scans beyond one bounded comment page before choosing the historical minimum', () =>
		Effect.gen(function* () {
			const owner = 'paged-owner'
			const [artifact] = yield* Effect.promise(() =>
				db
					.insert(artifacts)
					.values({
						organization_id: organizationA,
						task_id: taskA,
						resource_owner_user_id: owner,
						created_by: owner,
						file_name: '04-tdd-paged.md',
						content: '# Paged',
						content_hash: 'paged',
					})
					.returning(),
			)
			if (!artifact) return yield* Effect.die('seed failed')
			yield* Effect.promise(() =>
				db.insert(artifactComments).values(
					Array.from({ length: 501 }, (_, index) => ({
						organization_id: organizationA,
						resource_owner_user_id: owner,
						task_id: taskA,
						created_by_user_id: `paged-reviewer-${index}`,
						artifact_id: artifact.id,
						content_text: 'Paged review',
						created_at: BigInt(10_000 + index),
						updated_at: BigInt(10_000 + index),
					})),
				),
			)
			yield* run(organizationA, true)
			const [settings] = yield* Effect.promise(() =>
				db
					.select()
					.from(userSettings)
					.where(and(eq(userSettings.user_id, owner), eq(userSettings.organization_id, organizationA))),
			)
			expect(settings?.first_inbound_comment_received_at).toBe(10_000n)
		}).pipe(Effect.provide(PostgresDbLive(db))),
	)

	it.effect('preserves completed owners across a metadata failure and resumes safely after repair', () =>
		Effect.gen(function* () {
			const firstOwner = 'a-partial-owner'
			const failingOwner = 'z-partial-owner'
			const [firstArtifact, failingArtifact] = yield* Effect.promise(() =>
				db
					.insert(artifacts)
					.values([
						{
							organization_id: organizationA,
							task_id: taskA,
							resource_owner_user_id: firstOwner,
							created_by: firstOwner,
							file_name: '03-prd-partial-first.md',
							content: '# First',
							content_hash: 'partial-first',
						},
						{
							organization_id: organizationA,
							task_id: taskA,
							resource_owner_user_id: failingOwner,
							created_by: failingOwner,
							file_name: '03-prd-partial-failing.md',
							content: '# Failing',
							content_hash: 'partial-failing',
						},
					])
					.returning(),
			)
			if (!firstArtifact || !failingArtifact) return yield* Effect.die('seed failed')
			yield* Effect.promise(() =>
				db.insert(artifactComments).values([
					{
						organization_id: organizationA,
						resource_owner_user_id: firstOwner,
						task_id: taskA,
						created_by_user_id: 'partial-reviewer',
						artifact_id: firstArtifact.id,
						content_text: 'First review',
						created_at: 301n,
						updated_at: 301n,
					},
					{
						organization_id: organizationA,
						resource_owner_user_id: failingOwner,
						task_id: taskA,
						created_by_user_id: 'partial-reviewer',
						artifact_id: failingArtifact.id,
						content_text: 'Failing review',
						created_at: 302n,
						updated_at: 302n,
					},
				]),
			)
			yield* Effect.promise(() =>
				db.execute(`UPDATE artifacts SET frontmatter = '[]'::jsonb WHERE id = '${failingArtifact.id}'`),
			)

			const failure = yield* run(organizationA, true).pipe(Effect.flip)
			expect(failure._tag).toBe('CollaborationBackfillInvalidStoredMetadata')
			let settings = yield* Effect.promise(() => db.select().from(userSettings))
			expect(settings.find((row) => row.user_id === firstOwner)?.first_inbound_comment_received_at).toBe(301n)
			expect(settings.some((row) => row.user_id === failingOwner)).toBe(false)

			yield* Effect.promise(() =>
				db.execute(`UPDATE artifacts SET frontmatter = '{}'::jsonb WHERE id = '${failingArtifact.id}'`),
			)
			const resumed = yield* run(organizationA, true)
			expect(resumed.settingsRowsChanged).toBe(1)
			settings = yield* Effect.promise(() => db.select().from(userSettings))
			expect(settings.find((row) => row.user_id === firstOwner)?.first_inbound_comment_received_at).toBe(301n)
			expect(settings.find((row) => row.user_id === failingOwner)?.first_inbound_comment_received_at).toBe(302n)
		}).pipe(Effect.provide(PostgresDbLive(db))),
	)

	it.effect('fails apply when completeness verification finds a recoverable null owner', () =>
		Effect.gen(function* () {
			const owner = 'incomplete-owner'
			const [artifact] = yield* Effect.promise(() =>
				db
					.insert(artifacts)
					.values({
						organization_id: organizationA,
						task_id: taskA,
						resource_owner_user_id: owner,
						created_by: owner,
						file_name: '04-tdd-incomplete.md',
						content: '# Incomplete',
						content_hash: 'incomplete',
					})
					.returning(),
			)
			if (!artifact) return yield* Effect.die('seed failed')
			yield* Effect.promise(() =>
				db.insert(artifactComments).values({
					organization_id: organizationA,
					resource_owner_user_id: owner,
					task_id: taskA,
					created_by_user_id: 'incomplete-reviewer',
					artifact_id: artifact.id,
					content_text: 'Recoverable review',
					created_at: 401n,
					updated_at: 401n,
				}),
			)

			yield* Effect.acquireUseRelease(
				Effect.promise(async () => {
					await db.execute(`
						CREATE FUNCTION suppress_incomplete_owner_for_test() RETURNS trigger AS $$
						BEGIN
							IF NEW.user_id = 'incomplete-owner' THEN RETURN NULL; END IF;
							RETURN NEW;
						END;
						$$ LANGUAGE plpgsql
					`)
					await db.execute(`
						CREATE TRIGGER suppress_incomplete_owner_for_test
						BEFORE INSERT OR UPDATE ON user_settings
						FOR EACH ROW EXECUTE FUNCTION suppress_incomplete_owner_for_test()
					`)
				}),
				() =>
					Effect.gen(function* () {
						const failure = yield* run(organizationA, true).pipe(Effect.flip)
						expect(failure._tag).toBe('CollaborationBackfillIncompleteVerification')
					}),
				() =>
					Effect.promise(async () => {
						await db.execute(`DROP TRIGGER IF EXISTS suppress_incomplete_owner_for_test ON user_settings`)
						await db.execute(`DROP FUNCTION IF EXISTS suppress_incomplete_owner_for_test()`)
					}),
			)
		}).pipe(Effect.provide(PostgresDbLive(db))),
	)

	it.effect('preserves a concurrent live write while historical recovery races on separate transactions', () =>
		Effect.gen(function* () {
			const postgres = yield* PostgresDb
			const ownerUserId = 'concurrent-live-owner'
			const [artifact] = yield* Effect.promise(() =>
				db
					.insert(artifacts)
					.values({
						organization_id: organizationA,
						task_id: taskA,
						resource_owner_user_id: ownerUserId,
						created_by: ownerUserId,
						file_name: '03-prd-concurrent-live.md',
						content: '# Concurrent live write',
						content_hash: 'concurrent-live',
					})
					.returning(),
			)
			if (!artifact) return yield* Effect.die('seed failed')
			yield* Effect.promise(() =>
				db.insert(artifactComments).values({
					organization_id: organizationA,
					resource_owner_user_id: ownerUserId,
					task_id: taskA,
					created_by_user_id: 'historical-concurrent-reviewer',
					artifact_id: artifact.id,
					content_text: 'Historical feedback',
					created_at: 100n,
					updated_at: 100n,
				}),
			)
			const liveWriteReady = yield* Deferred.make<void>()
			const releaseLiveWrite = yield* Deferred.make<void>()
			const liveWrite = yield* postgres
				.transaction((tx) =>
					recordFirstInboundReviewComment(tx, {
						ownerUserId,
						organizationId: organizationA,
						commenterUserId: 'live-concurrent-reviewer',
						createdByAgent: false,
						frontmatterType: 'design-prd',
						now: 999n,
					}).pipe(
						Effect.andThen(Deferred.succeed(liveWriteReady, undefined)),
						Effect.andThen(Deferred.await(releaseLiveWrite)),
					),
				)
				.pipe(Effect.forkChild)
			yield* Deferred.await(liveWriteReady)
			const backfill = yield* run(organizationA, true).pipe(Effect.forkChild)
			yield* Effect.yieldNow
			yield* Deferred.succeed(releaseLiveWrite, undefined)
			yield* Fiber.join(liveWrite)
			yield* Fiber.join(backfill)
			const [settings] = yield* Effect.promise(() =>
				db
					.select()
					.from(userSettings)
					.where(and(eq(userSettings.user_id, ownerUserId), eq(userSettings.organization_id, organizationA))),
			)
			expect(settings?.first_inbound_comment_received_at).toBe(999n)
		}).pipe(Effect.provide(PostgresDbLive(db))),
	)
})
