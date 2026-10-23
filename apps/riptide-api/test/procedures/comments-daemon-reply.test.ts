import { randomUUID } from 'node:crypto'

import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { call } from '@orpc/server'
import { and, eq, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { getUserSettingsEffectProcedure } from '../../src/orpc/api/auth/user/settings-get.effect'
import { createCommentProcedure } from '../../src/orpc/api/comments/create'
import { resolveCommentProcedure } from '../../src/orpc/api/comments/resolve'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { replyCommentProcedure } from '../../src/orpc/daemon/comments/reply'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('daemon/comments/reply', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_comments_daemon_reply'
	const userId = 'user_comments_daemon_reply'
	const hostId = randomUUID()

	let taskId: string
	let artifactId: string
	const artifactFilename = 'daemon-reply-test.md'

	beforeAll(async () => {
		const testDb = await createTestDb('comments_daemon_reply')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({
				name: 'comment daemon reply test org',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'daemon reply test task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()

		if (!task) throw new Error('Unable to insert task for setup')
		taskId = task.id

		const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })
		const artifactResult = await call(
			upsertArtifactProcedure,
			{ taskId, fileName: artifactFilename, content: '# Daemon Reply Test' },
			{
				context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
			},
		)
		artifactId = artifactResult.artifactId
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function makeApiContext(uid = userId) {
		return createMockApiContext({
			auth: createMockApiAuth({ userId: uid, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})
	}

	function makeDaemonContext(uid = userId) {
		return createMockDaemonContext({
			auth: createMockDaemonAuth({ userId: uid, organizationId, hostId }),
			services: { db, dbReadReplica: db },
		})
	}

	async function createComment(contentText: string, replyToCommentId?: string) {
		const result = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText,
				...(replyToCommentId ? { replyToCommentId } : {}),
			},
			{ context: makeApiContext() },
		)

		return result.commentId
	}

	test('replying with a truncated reply ID normalizes to root and reopens the thread', async () => {
		const rootId = await createComment('Root comment')
		const childId = await createComment('First reply', rootId)

		await call(resolveCommentProcedure, { commentId: rootId, isResolved: true }, { context: makeApiContext() })

		const replyResult = await call(
			replyCommentProcedure,
			{
				taskId,
				artifactFilename,
				truncatedCommentId: childId.slice(-8),
				contentText: 'New daemon reply',
			},
			{ context: makeDaemonContext() },
		)

		expect(replyResult.success).toBe(true)
		expect(replyResult.parentCommentId).toBe(rootId)

		const rows = await db
			.select({
				id: artifactComments.id,
				reply_to_comment_id: artifactComments.reply_to_comment_id,
				is_resolved: artifactComments.is_resolved,
				resolved_by_user_id: artifactComments.resolved_by_user_id,
				created_by_agent: artifactComments.created_by_agent,
			})
			.from(artifactComments)
			.where(inArray(artifactComments.id, [rootId, childId, replyResult.commentId]))

		expect(rows).toHaveLength(3)
		expect(rows.every((row) => row.is_resolved === false)).toBe(true)
		expect(
			rows.filter((row) => row.id !== replyResult.commentId).every((row) => row.resolved_by_user_id === null),
		).toBe(true)

		const insertedReply = rows.find((row) => row.id === replyResult.commentId)
		expect(insertedReply?.reply_to_comment_id).toBe(rootId)
		expect(insertedReply?.created_by_agent).toBe(true)
	})

	test('records collaboration through API root and agent-reply paths and exposes it through settings-get', async () => {
		const artifactOwnerUserId = userId
		const collaboratorUserId = 'daemon-reply-collaborator'
		const planningFilename = '03-prd-daemon-reply.md'
		const [planningArtifact] = await db
			.insert(artifacts)
			.values({
				organization_id: organizationId,
				task_id: taskId,
				resource_owner_user_id: artifactOwnerUserId,
				created_by: artifactOwnerUserId,
				file_name: planningFilename,
				frontmatter: { type: 'design-prd' },
				content: '# Planning artifact',
				content_hash: 'daemon-reply-planning-artifact',
			})
			.returning()
		if (!planningArtifact) throw new Error('Unable to seed planning artifact')
		await db.insert(taskUserAcl).values({
			task_id: taskId,
			subject_user_id: collaboratorUserId,
			organization_id: organizationId,
			resource_owner_user_id: artifactOwnerUserId,
			permission_level: 'read',
			granted_by: artifactOwnerUserId,
		})

		const root = await call(
			createCommentProcedure,
			{ artifactId: planningArtifact.id, contentText: 'Human API feedback' },
			{ context: makeApiContext(collaboratorUserId) },
		)
		const ownerContext = makeApiContext(artifactOwnerUserId)
		const getOwnerSettings = bindProcedureToRuntime(
			getUserSettingsEffectProcedure,
			ownerContext.services.effectRuntime,
		)
		const settingsAfterHumanComment = await call(getOwnerSettings, {}, { context: ownerContext })
		expect(settingsAfterHumanComment.userSettings.firstInboundCommentReceivedAt).toBeTypeOf('number')

		const reply = await call(
			replyCommentProcedure,
			{
				taskId,
				artifactFilename: planningFilename,
				truncatedCommentId: root.commentId.slice(-8),
				contentText: 'Agent API feedback',
			},
			{ context: makeDaemonContext(collaboratorUserId) },
		)
		const settingsResult = await call(getOwnerSettings, {}, { context: ownerContext })
		const [replyRow] = await db.select().from(artifactComments).where(eq(artifactComments.id, reply.commentId))

		expect(replyRow).toMatchObject({
			artifact_id: planningArtifact.id,
			created_by_user_id: collaboratorUserId,
			created_by_agent: true,
			reply_to_comment_id: root.commentId,
		})
		expect(settingsResult.userSettings.firstInboundCommentReceivedAt).toBeTypeOf('number')
		expect(settingsResult.userSettings.firstInboundCommentReceivedAt).not.toBeNull()
		await ownerContext.services.effectRuntime.dispose()
	})

	test('covers the aggregate live-write matrix across every planning type and identity', async () => {
		const taskOwnerUserId = 'aggregate-task-owner'
		const artifactOwnerUserId = 'aggregate-artifact-owner'
		const artifactCreatorUserId = 'aggregate-artifact-creator'
		const collaboratorUserId = 'aggregate-collaborator'
		const [aggregateTask] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Aggregate collaboration task',
				resource_owner_user_id: taskOwnerUserId,
				created_by: artifactCreatorUserId,
			})
			.returning()
		if (!aggregateTask) throw new Error('Unable to seed aggregate task')
		await db.insert(taskUserAcl).values(
			[artifactOwnerUserId, collaboratorUserId].map((subjectUserId) => ({
				task_id: aggregateTask.id,
				subject_user_id: subjectUserId,
				organization_id: organizationId,
				resource_owner_user_id: taskOwnerUserId,
				permission_level: 'comment' as const,
				granted_by: taskOwnerUserId,
			})),
		)
		const [otherOrganization] = await db
			.insert(organizations)
			.values({ name: 'Aggregate isolation org', workos_organization_id: `aggregate-isolation-${randomUUID()}` })
			.returning()
		if (!otherOrganization) throw new Error('Unable to seed isolation organization')
		await db.insert(userSettings).values({
			user_id: artifactOwnerUserId,
			organization_id: otherOrganization.id,
			theme: 'monokai',
		})
		const planningCases = [
			{ type: 'design-discussion', fileName: 'aggregate-discussion.md', kind: 'comment' as const },
			{ type: 'design-prd', fileName: 'aggregate-prd.md', kind: 'deletion' as const },
			{ type: 'design-tdd', fileName: 'aggregate-tdd.md', kind: 'approval' as const },
			{ type: 'structure-outline', fileName: 'aggregate-outline.md', kind: 'comment' as const },
		]
		const aggregateArtifacts = await db
			.insert(artifacts)
			.values(
				planningCases.map((planningCase, index) => ({
					organization_id: organizationId,
					task_id: aggregateTask.id,
					resource_owner_user_id: artifactOwnerUserId,
					created_by: artifactCreatorUserId,
					file_name: planningCase.fileName,
					frontmatter: { type: planningCase.type },
					content: '# Aggregate collaboration',
					content_hash: `aggregate-collaboration-${index}`,
				})),
			)
			.returning()
		const ownerApiContext = makeApiContext(artifactOwnerUserId)
		const collaboratorApiContext = makeApiContext(collaboratorUserId)
		const ownerDaemonContext = makeDaemonContext(artifactOwnerUserId)
		const collaboratorDaemonContext = makeDaemonContext(collaboratorUserId)
		const getOwnerSettings = bindProcedureToRuntime(
			getUserSettingsEffectProcedure,
			ownerApiContext.services.effectRuntime,
		)

		try {
			for (const [index, artifact] of aggregateArtifacts.entries()) {
				await db
					.update(userSettings)
					.set({ first_inbound_comment_received_at: null })
					.where(
						and(
							eq(userSettings.user_id, artifactOwnerUserId),
							eq(userSettings.organization_id, organizationId),
						),
					)
				const selfRoot = await call(
					createCommentProcedure,
					{
						artifactId: artifact.id,
						contentText: 'Self feedback does not qualify',
						kind: planningCases[index]?.kind,
					},
					{ context: ownerApiContext },
				)
				const selfChild = await call(
					createCommentProcedure,
					{
						artifactId: artifact.id,
						contentText: 'Nested self feedback',
						replyToCommentId: selfRoot.commentId,
					},
					{ context: ownerApiContext },
				)
				const ownAgentReply = await call(
					replyCommentProcedure,
					{
						taskId: aggregateTask.id,
						artifactFilename: planningCases[index]?.fileName ?? '',
						truncatedCommentId: selfChild.commentId.slice(-8),
						contentText: 'Own agent feedback does not qualify',
					},
					{ context: ownerDaemonContext },
				)
				expect(ownAgentReply.parentCommentId).toBe(selfRoot.commentId)
				let ownerSettings = await call(getOwnerSettings, {}, { context: ownerApiContext })
				expect(ownerSettings.userSettings.firstInboundCommentReceivedAt).toBeNull()

				const humanRoot = await call(
					createCommentProcedure,
					{
						artifactId: artifact.id,
						contentText: 'Cross-user human feedback qualifies',
						kind: planningCases[index]?.kind,
					},
					{ context: collaboratorApiContext },
				)
				ownerSettings = await call(getOwnerSettings, {}, { context: ownerApiContext })
				expect(ownerSettings.userSettings.firstInboundCommentReceivedAt).toBeTypeOf('number')
				await db
					.update(userSettings)
					.set({ first_inbound_comment_received_at: null })
					.where(
						and(
							eq(userSettings.user_id, artifactOwnerUserId),
							eq(userSettings.organization_id, organizationId),
						),
					)
				const agentReply = await call(
					replyCommentProcedure,
					{
						taskId: aggregateTask.id,
						artifactFilename: planningCases[index]?.fileName ?? '',
						truncatedCommentId: humanRoot.commentId.slice(-8),
						contentText: 'Cross-user agent feedback qualifies',
					},
					{ context: collaboratorDaemonContext },
				)
				ownerSettings = await call(getOwnerSettings, {}, { context: ownerApiContext })
				expect(ownerSettings.userSettings.firstInboundCommentReceivedAt).toBeTypeOf('number')
				const [agentReplyRow] = await db
					.select()
					.from(artifactComments)
					.where(eq(artifactComments.id, agentReply.commentId))
				expect(agentReplyRow).toMatchObject({
					artifact_id: artifact.id,
					created_by_user_id: collaboratorUserId,
					created_by_agent: true,
					reply_to_comment_id: humanRoot.commentId,
				})
			}

			const [otherOrgSettings] = await db
				.select()
				.from(userSettings)
				.where(
					and(
						eq(userSettings.user_id, artifactOwnerUserId),
						eq(userSettings.organization_id, otherOrganization.id),
					),
				)
			expect(otherOrgSettings).toMatchObject({
				first_inbound_comment_received_at: null,
				theme: 'monokai',
			})
			const taskOwnerSettings = await db
				.select()
				.from(userSettings)
				.where(eq(userSettings.user_id, taskOwnerUserId))
			expect(taskOwnerSettings).toHaveLength(0)
		} finally {
			await Promise.all([
				ownerApiContext.services.effectRuntime.dispose(),
				collaboratorApiContext.services.effectRuntime.dispose(),
				ownerDaemonContext.services.effectRuntime.dispose(),
				collaboratorDaemonContext.services.effectRuntime.dispose(),
			])
		}
	})

	test('rejects ambiguous truncated IDs', async () => {
		const suffix = randomUUID().slice(-12)
		const firstCommentId = `${randomUUID().slice(0, 24)}${suffix}`
		const secondCommentId = `${randomUUID().slice(0, 24)}${suffix}`

		await db.insert(artifactComments).values([
			{
				id: firstCommentId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				task_id: taskId,
				created_by_user_id: userId,
				artifact_id: artifactId,
				content_text: 'First ambiguous root',
			},
			{
				id: secondCommentId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				task_id: taskId,
				created_by_user_id: userId,
				artifact_id: artifactId,
				content_text: 'Second ambiguous root',
			},
		])

		await expect(
			call(
				replyCommentProcedure,
				{
					taskId,
					artifactFilename,
					truncatedCommentId: suffix,
					contentText: 'This should fail',
				},
				{ context: makeDaemonContext() },
			),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })

		const matchingRows = await db
			.select({ id: artifactComments.id })
			.from(artifactComments)
			.where(inArray(artifactComments.id, [firstCommentId, secondCommentId]))

		expect(matchingRows).toHaveLength(2)
	})

	test('rejects missing truncated parent IDs', async () => {
		await expect(
			call(
				replyCommentProcedure,
				{
					taskId,
					artifactFilename,
					truncatedCommentId: 'deadbeef',
					contentText: 'Missing parent',
				},
				{ context: makeDaemonContext() },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })

		const [missingReply] = await db
			.select()
			.from(artifactComments)
			.where(eq(artifactComments.content_text, 'Missing parent'))

		expect(missingReply).toBeUndefined()
	})
})
