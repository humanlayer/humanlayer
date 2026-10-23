import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { apiRouter } from '../../src/orpc/router'
import { createMockApiAuth, createMockApiAuthNoOrg, createMockApiContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('Metrics Endpoints', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let nearMidnightUtcDate: string
	let nearMidnightPstDate: string
	let nearMidnightUtcIsWeekend: boolean
	let nearMidnightPstIsWeekend: boolean
	const workosOrganizationId = 'org_metrics_test'
	const adminUserId = 'user_admin_123'
	const memberUserId = 'user_member_456'
	const hostId = randomUUID()
	const callContext = () => ({
		context: createMockApiContext({
			auth: createMockApiAuth({
				userId: adminUserId,
				organizationId,
				workosOrganizationId,
				role: 'admin' as const,
			}),
			services: { db, dbReadReplica: db },
		}),
	})

	beforeAll(async () => {
		const testDb = await createTestDb('metrics')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({
				name: 'test metrics org',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization')
		organizationId = org.id

		// Create test sessions with different dates
		const now = Date.now()
		const dayMs = 24 * 60 * 60 * 1000

		// Near-midnight UTC session for timezone-bucketing tests.
		// Use a dynamic date 30 days ago at 01:00 UTC so it's always inside the 90d window.
		// 01:00 UTC == 17:00 PST on the previous calendar day, which exercises the
		// timezone-bucketing boundary regardless of when the test runs.
		const nearMidnightBase = new Date(now - 30 * dayMs)
		nearMidnightBase.setUTCHours(1, 0, 0, 0)
		const nearMidnightUTC = nearMidnightBase.getTime()
		nearMidnightUtcDate = nearMidnightBase.toISOString().slice(0, 10)
		const nearMidnightPstBase = new Date(nearMidnightUTC - 8 * 60 * 60 * 1000)
		nearMidnightPstDate = nearMidnightPstBase.toISOString().slice(0, 10)
		// Saturday=6, Sunday=0 in UTC
		const utcDow = nearMidnightBase.getUTCDay()
		const pstDow = nearMidnightPstBase.getUTCDay()
		nearMidnightUtcIsWeekend = utcDow === 0 || utcDow === 6
		nearMidnightPstIsWeekend = pstDow === 0 || pstDow === 6

		await db.insert(sessions).values([
			{
				organization_id: organizationId,
				resource_owner_user_id: adminUserId,
				created_by: adminUserId,
				host_id: hostId,
				working_directory: tmpdir(),
				coding_agent: 'claude',
				status: 'ready_for_input',
				created_at: BigInt(now - dayMs), // Yesterday
				num_events: 10,
			},
			{
				organization_id: organizationId,
				resource_owner_user_id: memberUserId,
				created_by: memberUserId,
				host_id: hostId,
				working_directory: tmpdir(),
				coding_agent: 'claude',
				status: 'ready_for_input',
				created_at: BigInt(now - dayMs), // Yesterday (same day, different user)
				num_events: 5,
			},
			{
				organization_id: organizationId,
				resource_owner_user_id: adminUserId,
				created_by: adminUserId,
				host_id: hostId,
				working_directory: tmpdir(),
				coding_agent: 'claude',
				status: 'ready_for_input',
				created_at: BigInt(now - 2 * dayMs), // 2 days ago
				num_events: 8,
			},
			{
				organization_id: organizationId,
				resource_owner_user_id: adminUserId,
				created_by: adminUserId,
				host_id: hostId,
				working_directory: tmpdir(),
				coding_agent: 'claude',
				status: 'ready_for_input',
				created_at: BigInt(nearMidnightUTC), // Near-midnight UTC: 01:00 UTC
				num_events: 3,
			},
		])
	}, 30000)

	describe('metrics.dailyActiveUsers', () => {
		test('User can fetch DAU metrics', async () => {
			const result = await call(apiRouter.metrics.dailyActiveUsers, { range: '7d' }, callContext())

			expect(result.data).toBeDefined()
			expect(result.data.length).toBeGreaterThan(0)
			expect(result.averageWeekday).toBeGreaterThanOrEqual(0)
			expect(result.startDate).toBeDefined()
			expect(result.endDate).toBeDefined()
		})

		test('Non-admin user can fetch DAU metrics', async () => {
			const result = await call(
				apiRouter.metrics.dailyActiveUsers,
				{ range: '7d' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({
							userId: memberUserId,
							organizationId,
							workosOrganizationId,
							role: 'member',
						}),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.data).toBeDefined()
			expect(result.data.length).toBeGreaterThan(0)
		})

		test('DAU returns data in expected format', async () => {
			const result = await call(apiRouter.metrics.dailyActiveUsers, { range: '7d' }, callContext())

			expect(result.data).toBeInstanceOf(Array)
			expect(result.data.length).toBeGreaterThan(0)

			for (const dataPoint of result.data) {
				expect(dataPoint).toHaveProperty('date')
				expect(dataPoint).toHaveProperty('users')
				expect(dataPoint).toHaveProperty('isWeekend')
				expect(typeof dataPoint.date).toBe('string')
				expect(typeof dataPoint.users).toBe('number')
				expect(typeof dataPoint.isWeekend).toBe('boolean')
			}
		})

		test('DAU with timezoneOffset=0 buckets near-midnight session on UTC date', async () => {
			const result = await call(
				apiRouter.metrics.dailyActiveUsers,
				{ range: '90d', timezoneOffset: 0 },
				callContext(),
			)

			const utcDay = result.data.find((d) => d.date === nearMidnightUtcDate)
			expect(utcDay).toBeDefined()
			expect(utcDay!.users).toBeGreaterThanOrEqual(1)
		})

		test('DAU with timezoneOffset=480 (PST) shifts near-midnight session to previous day', async () => {
			const result = await call(
				apiRouter.metrics.dailyActiveUsers,
				{ range: '90d', timezoneOffset: 480 },
				callContext(),
			)

			// 01:00 UTC = 17:00 PST on the previous calendar day
			const pstDay = result.data.find((d) => d.date === nearMidnightPstDate)
			expect(pstDay).toBeDefined()
			expect(pstDay!.users).toBeGreaterThanOrEqual(1)
		})

		test('isWeekend reflects offset-adjusted day', async () => {
			const result = await call(
				apiRouter.metrics.dailyActiveUsers,
				{ range: '90d', timezoneOffset: 0 },
				callContext(),
			)

			const utcDay = result.data.find((d) => d.date === nearMidnightUtcDate)
			if (utcDay) {
				expect(utcDay.isWeekend).toBe(nearMidnightUtcIsWeekend)
			}

			const pstDay = result.data.find((d) => d.date === nearMidnightPstDate)
			if (pstDay) {
				expect(pstDay.isWeekend).toBe(nearMidnightPstIsWeekend)
			}
		})
	})

	describe('metrics.sessionsPerDay', () => {
		test('sessionsPerDay with offset produces correct bucket shifts', async () => {
			// With offset=0, the near-midnight session (01:00 UTC) buckets to the UTC date
			const resultUtc = await call(
				apiRouter.metrics.sessionsPerDay,
				{ range: '90d', timezoneOffset: 0 },
				callContext(),
			)

			const utcDay = resultUtc.data.find((d) => d.date === nearMidnightUtcDate)
			expect(utcDay).toBeDefined()
			expect(utcDay!.sessions).toBeGreaterThanOrEqual(1)

			// With offset=480 (PST), same session shifts to the previous calendar day
			const resultPst = await call(
				apiRouter.metrics.sessionsPerDay,
				{ range: '90d', timezoneOffset: 480 },
				callContext(),
			)

			const pstDay = resultPst.data.find((d) => d.date === nearMidnightPstDate)
			expect(pstDay).toBeDefined()
			expect(pstDay!.sessions).toBeGreaterThanOrEqual(1)
		})
	})

	describe('metrics.sessionsPerWeek', () => {
		test('sessionsPerWeek returns weekly bucket shape with total', async () => {
			const result = await call(apiRouter.metrics.sessionsPerWeek, { weeks: 12 }, callContext())

			expect(result.data).toBeInstanceOf(Array)
			expect(result.data.length).toBeGreaterThan(0)
			expect(result.startDate).toBeDefined()
			expect(result.endDate).toBeDefined()
			expect(typeof result.total).toBe('number')

			for (const dataPoint of result.data) {
				expect(dataPoint).toHaveProperty('weekStart')
				expect(dataPoint).toHaveProperty('sessions')
				expect(typeof dataPoint.weekStart).toBe('string')
				expect(typeof dataPoint.sessions).toBe('number')
			}

			// total must equal the sum of per-week session counts
			const summed = result.data.reduce((sum, d) => sum + d.sessions, 0)
			expect(result.total).toBe(summed)

			// 4 sessions were seeded within the 12-week window (no DISTINCT)
			expect(result.total).toBeGreaterThanOrEqual(4)
		})

		test('sessionsPerWeek with offset produces correct bucket shifts', async () => {
			// With offset=0, the near-midnight session buckets to the UTC week
			const resultUtc = await call(
				apiRouter.metrics.sessionsPerWeek,
				{ weeks: 12, timezoneOffset: 0 },
				callContext(),
			)
			expect(resultUtc.data.some((d) => d.sessions > 0)).toBe(true)

			// With offset=480 (PST), counts are still produced (bucketing shifts but total preserved)
			const resultPst = await call(
				apiRouter.metrics.sessionsPerWeek,
				{ weeks: 12, timezoneOffset: 480 },
				callContext(),
			)
			expect(resultPst.total).toBe(resultUtc.total)
		})

		test('sessionsPerWeek scopes to the caller organization', async () => {
			const otherOrgId = randomUUID()
			const result = await call(
				apiRouter.metrics.sessionsPerWeek,
				{ weeks: 12 },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({
							userId: 'user_other_org',
							organizationId: otherOrgId,
							workosOrganizationId: 'org_other_test',
						}),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(result.data.every((d) => d.sessions === 0)).toBe(true)
			expect(result.total).toBe(0)
		})
	})

	describe('metrics.activeUsers chart endpoints', () => {
		// Seed per-user weekly sessions + comments across two distinct weeks, plus a
		// comment-only user and a soft-deleted comment that must be excluded.
		const heatmapSessionUser = `user_heat_sessions_${randomUUID()}`
		const heatmapCommentUser = `user_heat_comments_${randomUUID()}`
		// Collaboration actor: writes one comment on their OWN task (counts toward
		// `comments` only) and one comment on heatmapCommentUser's task (counts toward
		// both `comments` and `collaboration`).
		const heatmapCollabUser = `user_heat_collab_${randomUUID()}`
		// Receive-only owner: has no sessions and authors no comments, but owns a doc
		// that another user comments on. Must still appear as a heatmap row via inbound.
		const heatmapInboundOnlyUser = `user_heat_inbound_${randomUUID()}`
		let heatmapTaskId: string
		let heatmapArtifactId: string

		beforeAll(async () => {
			const now = Date.now()
			const weekMs = 7 * 24 * 60 * 60 * 1000
			// Two distinct weeks well inside the default 8-week window.
			const recentWeek = BigInt(now - 1 * weekMs)
			const priorWeek = BigInt(now - 3 * weekMs)

			// Sessions attributed to heatmapSessionUser via created_by across two weeks.
			await db.insert(sessions).values([
				{
					organization_id: organizationId,
					resource_owner_user_id: heatmapSessionUser,
					created_by: heatmapSessionUser,
					host_id: hostId,
					working_directory: tmpdir(),
					coding_agent: 'claude',
					status: 'ready_for_input',
					created_at: priorWeek,
					num_events: 4,
				},
				{
					organization_id: organizationId,
					resource_owner_user_id: heatmapSessionUser,
					created_by: heatmapSessionUser,
					host_id: hostId,
					working_directory: tmpdir(),
					coding_agent: 'claude',
					status: 'ready_for_input',
					created_at: recentWeek,
					num_events: 2,
				},
			])

			// One org-scoped task + artifact to satisfy artifact_comments FKs.
			const [task] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					created_by: heatmapCommentUser,
					resource_owner_user_id: heatmapCommentUser,
					name: 'heatmap test task',
				})
				.returning()
			if (!task) throw new Error('Unable to insert heatmap task')
			heatmapTaskId = task.id

			const [artifact] = await db
				.insert(artifacts)
				.values({
					task_id: heatmapTaskId,
					organization_id: organizationId,
					resource_owner_user_id: heatmapCommentUser,
					created_by: heatmapCommentUser,
					file_name: 'heatmap.md',
					content: 'heatmap',
					content_hash: 'heatmap-hash',
				})
				.returning()
			if (!artifact) throw new Error('Unable to insert heatmap artifact')
			heatmapArtifactId = artifact.id

			// Comments attributed to heatmapCommentUser via created_by_user_id across two
			// weeks, plus one soft-deleted comment in the recent week that must be excluded.
			await db.insert(artifactComments).values([
				{
					organization_id: organizationId,
					resource_owner_user_id: heatmapCommentUser,
					task_id: heatmapTaskId,
					artifact_id: heatmapArtifactId,
					created_by_user_id: heatmapCommentUser,
					content_text: 'prior week comment',
					created_at: priorWeek,
					is_deleted: false,
				},
				{
					organization_id: organizationId,
					resource_owner_user_id: heatmapCommentUser,
					task_id: heatmapTaskId,
					artifact_id: heatmapArtifactId,
					created_by_user_id: heatmapCommentUser,
					content_text: 'recent week comment',
					created_at: recentWeek,
					is_deleted: false,
				},
				{
					organization_id: organizationId,
					resource_owner_user_id: heatmapCommentUser,
					task_id: heatmapTaskId,
					artifact_id: heatmapArtifactId,
					created_by_user_id: heatmapCommentUser,
					content_text: 'deleted comment should be excluded',
					created_at: recentWeek,
					is_deleted: true,
				},
			])

			// Collaboration seeding: a task + artifact owned by heatmapCollabUser so the
			// collab user can comment on their OWN doc (no collaboration credit).
			const [collabTask] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					created_by: heatmapCollabUser,
					resource_owner_user_id: heatmapCollabUser,
					name: 'heatmap collab own task',
				})
				.returning()
			if (!collabTask) throw new Error('Unable to insert heatmap collab task')

			const [collabArtifact] = await db
				.insert(artifacts)
				.values({
					task_id: collabTask.id,
					organization_id: organizationId,
					resource_owner_user_id: heatmapCollabUser,
					created_by: heatmapCollabUser,
					file_name: 'collab.md',
					content: 'collab',
					content_hash: 'collab-hash',
				})
				.returning()
			if (!collabArtifact) throw new Error('Unable to insert heatmap collab artifact')

			await db.insert(artifactComments).values([
				// Own-doc comment: created_by_user_id == resource_owner_user_id.
				// Counts toward `comments`, NOT `collaboration`.
				{
					organization_id: organizationId,
					resource_owner_user_id: heatmapCollabUser,
					task_id: collabTask.id,
					artifact_id: collabArtifact.id,
					created_by_user_id: heatmapCollabUser,
					content_text: 'own doc comment',
					created_at: recentWeek,
					is_deleted: false,
				},
				// Cross-doc comment: collab user comments on heatmapCommentUser's doc.
				// created_by_user_id (collab) != resource_owner_user_id (comment user).
				// Counts toward `comments` + `collaborationOutbound` for the collab user,
				// and `collaborationInbound` for heatmapCommentUser.
				{
					organization_id: organizationId,
					resource_owner_user_id: heatmapCommentUser,
					task_id: heatmapTaskId,
					artifact_id: heatmapArtifactId,
					created_by_user_id: heatmapCollabUser,
					content_text: 'cross doc comment',
					created_at: recentWeek,
					is_deleted: false,
				},
			])

			// Receive-only owner: a task + artifact owned by heatmapInboundOnlyUser, with
			// a cross-doc comment written by heatmapCollabUser. The owner has no sessions
			// and authors no comments, so they should only surface via inbound collaboration.
			const [inboundTask] = await db
				.insert(tasks)
				.values({
					organization_id: organizationId,
					created_by: heatmapInboundOnlyUser,
					resource_owner_user_id: heatmapInboundOnlyUser,
					name: 'heatmap inbound-only task',
				})
				.returning()
			if (!inboundTask) throw new Error('Unable to insert heatmap inbound task')

			const [inboundArtifact] = await db
				.insert(artifacts)
				.values({
					task_id: inboundTask.id,
					organization_id: organizationId,
					resource_owner_user_id: heatmapInboundOnlyUser,
					created_by: heatmapInboundOnlyUser,
					file_name: 'inbound.md',
					content: 'inbound',
					content_hash: 'inbound-hash',
				})
				.returning()
			if (!inboundArtifact) throw new Error('Unable to insert heatmap inbound artifact')

			await db.insert(artifactComments).values([
				{
					organization_id: organizationId,
					resource_owner_user_id: heatmapInboundOnlyUser,
					task_id: inboundTask.id,
					artifact_id: inboundArtifact.id,
					created_by_user_id: heatmapCollabUser,
					content_text: 'inbound-only doc comment',
					created_at: recentWeek,
					is_deleted: false,
				},
			])
		}, 30000)

		test('chart endpoints return only the requested metric series', async () => {
			const [sessionsResult, commentsResult, outboundResult, inboundResult] = await Promise.all([
				call(apiRouter.metrics.activeUsersSessions, { weeks: 8, limit: 10 }, callContext()),
				call(apiRouter.metrics.activeUsersComments, { weeks: 8, limit: 10 }, callContext()),
				call(apiRouter.metrics.activeUsersCollaborationOutbound, { weeks: 8, limit: 10 }, callContext()),
				call(apiRouter.metrics.activeUsersCollaborationInbound, { weeks: 8, limit: 10 }, callContext()),
			])

			const sessionsUser = sessionsResult.users.find((u) => u.userId === heatmapSessionUser)
			expect(sessionsUser).toBeDefined()
			expect(sessionsUser!.values.length).toBe(sessionsResult.weekStarts.length)
			expect(sessionsUser!.total).toBe(2)

			const commentsUser = commentsResult.users.find((u) => u.userId === heatmapCollabUser)
			expect(commentsUser).toBeDefined()
			expect(commentsUser!.total).toBe(3)

			const outboundUser = outboundResult.users.find((u) => u.userId === heatmapCollabUser)
			expect(outboundUser).toBeDefined()
			expect(outboundUser!.total).toBe(2)

			const inboundUser = inboundResult.users.find((u) => u.userId === heatmapInboundOnlyUser)
			expect(inboundUser).toBeDefined()
			expect(inboundUser!.total).toBe(1)
		})

		test('chart endpoints respect caller organization and limit', async () => {
			const result = await call(apiRouter.metrics.activeUsersSessions, { weeks: 8, limit: 1 }, callContext())
			expect(result.users.length).toBeLessThanOrEqual(1)

			const otherOrgId = randomUUID()
			const crossOrg = await call(
				apiRouter.metrics.activeUsersSessions,
				{ weeks: 8, limit: 10 },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({
							userId: 'user_other_org',
							organizationId: otherOrgId,
							workosOrganizationId: 'org_other_test',
						}),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			expect(crossOrg.users).toEqual([])
		})
	})

	describe('metrics access control', () => {
		test('Unauthenticated user is rejected', async () => {
			await expect(
				call(
					apiRouter.metrics.dailyActiveUsers,
					{ range: '7d' },
					{
						context: createMockApiContext({ auth: null, services: { db, dbReadReplica: db } }),
					},
				),
			).rejects.toThrow()
		})

		test('User without organization is rejected', async () => {
			await expect(
				call(
					apiRouter.metrics.dailyActiveUsers,
					{ range: '7d' },
					{
						context: createMockApiContext({
							auth: createMockApiAuthNoOrg({ userId: memberUserId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			).rejects.toThrow()
		})

		test('User from different organization sees empty data', async () => {
			const otherOrgId = randomUUID()
			const result = await call(
				apiRouter.metrics.dailyActiveUsers,
				{ range: '7d' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({
							userId: 'user_other_org',
							organizationId: otherOrgId,
							workosOrganizationId: 'org_other_test',
						}),
						services: { db, dbReadReplica: db },
					}),
				},
			)

			// Cross-org user gets empty data, not an error
			expect(result.data).toBeDefined()
			expect(result.data.every((d) => d.users === 0)).toBe(true)
		})
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
