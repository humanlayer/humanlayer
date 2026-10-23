import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll } from 'vitest'

import { SlackService } from '../../src/effects/services/slack/slack.service'
import { type SlackArtifactEvent } from '../../src/effects/services/slack/slack.types'
import { upsertApiArtifactProcedure as liveUpsertApiArtifactProcedure } from '../../src/orpc/api/artifacts/upsert.effect'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('artifact upsert Slack dispatch', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
	let upsertApiArtifactProcedure: typeof liveUpsertApiArtifactProcedure
	let dispatchedEvents: SlackArtifactEvent[] = []

	const userId = 'user-artifact-slack'

	beforeAll(async () => {
		const testDb = await createTestDb('artifacts_upsert_slack')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Artifact Slack org', workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!organization) throw new Error('Failed to create organization')
		organizationId = organization.id

		runtime = createRuntimeWithTestPostgresLayer(db, {
			slack: Layer.succeed(SlackService, {
				createInstallUrl: () => Effect.die('createInstallUrl not used'),
				exchangeCode: () => Effect.die('exchangeCode not used'),
				getStatus: () => Effect.die('getStatus not used'),
				disconnect: () => Effect.die('disconnect not used'),
				listChannels: () => Effect.die('listChannels not used'),
				dispatchArtifactEvent: (event) => Effect.sync(() => dispatchedEvents.push(event)),
				dispatchCommentEvent: () => Effect.void,
				verifyInteractionRequest: () => Effect.die('verifyInteractionRequest not used'),
				handleInteractionPayload: () => Effect.void,
			}),
		})
		upsertApiArtifactProcedure = bindProcedureToRuntime(liveUpsertApiArtifactProcedure, runtime)
	}, 60000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	it.effect('forks artifact Slack dispatch for API artifact inserts only', ({ expect }) => {
		dispatchedEvents = []
		return Effect.gen(function* () {
			const [task] = yield* Effect.promise(() =>
				db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						created_by: userId,
						resource_owner_user_id: userId,
						name: 'Slack upsert task',
						slug: 'slack-upsert-task',
					})
					.returning(),
			)
			if (!task) throw new Error('Failed to create task')

			const context = createMockApiContext({
				auth: createMockApiAuth({
					userId,
					organizationId,
					workosOrganizationId: `workos-${organizationId}`,
				}),
				services: { db, dbReadReplica: db },
			})

			const result = yield* Effect.promise(() =>
				call(
					upsertApiArtifactProcedure,
					{
						taskId: task.id,
						fileName: '07-structure-outline.md',
						content: '# Outline',
						frontmatter: { type: 'structure-outline' },
					},
					{ context },
				),
			)

			expect(result.created).toBe(true)
			yield* waitForEffect(() => dispatchedEvents.length === 1)
			expect(dispatchedEvents[0]).toMatchObject({
				organizationId,
				taskId: task.id,
				taskSlug: 'slack-upsert-task',
				artifactId: result.artifactId,
				fileName: '07-structure-outline.md',
				artifactType: 'structure-outline',
				resourceOwnerUserId: userId,
				actorUserId: userId,
				created: true,
			})

			const updateResult = yield* Effect.promise(() =>
				call(
					upsertApiArtifactProcedure,
					{
						taskId: task.id,
						fileName: '07-structure-outline.md',
						content: '# Outline\n\nUpdated content',
						frontmatter: { type: 'structure-outline' },
					},
					{ context },
				),
			)

			expect(updateResult).toMatchObject({ created: false, artifactId: result.artifactId, versionNumber: 1 })
			yield* settleDetachedEffects
			expect(dispatchedEvents).toHaveLength(1)
		})
	})

	it.effect('forks artifact Slack dispatch for daemon artifact inserts only', ({ expect }) => {
		dispatchedEvents = []
		return Effect.gen(function* () {
			const [task] = yield* Effect.promise(() =>
				db
					.insert(tasks)
					.values({
						organization_id: organizationId,
						created_by: userId,
						resource_owner_user_id: userId,
						name: 'Daemon Slack upsert task',
						slug: 'daemon-slack-upsert-task',
					})
					.returning(),
			)
			if (!task) throw new Error('Failed to create task')

			const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId: 'host-artifact-slack' })
			const daemonContext = createMockDaemonContext({
				auth: daemonAuth,
				services: { db, dbReadReplica: db, effectRuntime: runtime },
			})

			const result = yield* Effect.promise(() =>
				call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: '08-design-discussion.md',
						content: '# Design discussion',
						frontmatter: { type: 'design-discussion' },
					},
					{ context: daemonContext },
				),
			)

			expect(result.created).toBe(true)
			yield* waitForEffect(() => dispatchedEvents.length === 1)
			expect(dispatchedEvents[0]).toMatchObject({
				organizationId,
				taskId: task.id,
				taskSlug: 'daemon-slack-upsert-task',
				artifactId: result.artifactId,
				fileName: '08-design-discussion.md',
				artifactType: 'design-discussion',
				resourceOwnerUserId: userId,
				actorUserId: userId,
				created: true,
			})

			const updateResult = yield* Effect.promise(() =>
				call(
					upsertArtifactProcedure,
					{
						taskId: task.id,
						fileName: '08-design-discussion.md',
						content: '# Design discussion\n\nUpdated content',
						frontmatter: { type: 'design-discussion' },
					},
					{ context: daemonContext },
				),
			)

			expect(updateResult).toMatchObject({ created: false, artifactId: result.artifactId, versionNumber: 1 })
			yield* settleDetachedEffects
			expect(dispatchedEvents).toHaveLength(1)
		})
	})

	it.effect('still returns success when forked Slack dispatch defects', ({ expect }) => {
		return Effect.gen(function* () {
			const defectRuntime = createRuntimeWithTestPostgresLayer(db, {
				slack: Layer.succeed(SlackService, {
					createInstallUrl: () => Effect.die('createInstallUrl not used'),
					exchangeCode: () => Effect.die('exchangeCode not used'),
					getStatus: () => Effect.die('getStatus not used'),
					disconnect: () => Effect.die('disconnect not used'),
					listChannels: () => Effect.die('listChannels not used'),
					dispatchArtifactEvent: () => Effect.die('slack defect'),
					dispatchCommentEvent: () => Effect.void,
					verifyInteractionRequest: () => Effect.die('verifyInteractionRequest not used'),
					handleInteractionPayload: () => Effect.void,
				}),
			})

			try {
				const defectingUpsert = bindProcedureToRuntime(liveUpsertApiArtifactProcedure, defectRuntime)
				const [task] = yield* Effect.promise(() =>
					db
						.insert(tasks)
						.values({
							organization_id: organizationId,
							created_by: userId,
							resource_owner_user_id: userId,
							name: 'Slack defect task',
							slug: 'slack-defect-task',
						})
						.returning(),
				)
				if (!task) throw new Error('Failed to create task')

				const result = yield* Effect.promise(() =>
					call(
						defectingUpsert,
						{
							taskId: task.id,
							fileName: '08-tdd.md',
							content: '# TDD',
							frontmatter: { type: 'design-tdd' },
						},
						{
							context: createMockApiContext({
								auth: createMockApiAuth({
									userId,
									organizationId,
									workosOrganizationId: `workos-${organizationId}`,
								}),
								services: { db, dbReadReplica: db },
							}),
						},
					),
				)

				expect(result).toMatchObject({ created: true })
			} finally {
				yield* Effect.promise(() => defectRuntime.dispose())
			}
		})
	})
})

const waitForEffect = (predicate: () => boolean) =>
	Effect.promise(async () => {
		for (let attempt = 0; attempt < 20; attempt += 1) {
			if (predicate()) return
			await new Promise((resolve) => setTimeout(resolve, 10))
		}
		throw new Error('Timed out waiting for predicate')
	})

const settleDetachedEffects = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 50)))
