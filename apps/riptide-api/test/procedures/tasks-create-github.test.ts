import { randomUUID } from 'node:crypto'

import { artifacts } from '@humanlayer/db/tables/artifacts'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { hash } from 'ohash'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
	GitHubIntegrationUnavailableError,
	GitHubIssueInputInvalidError,
	GitHubRepositoryNotAccessibleError,
} from '../../src/effects/services/github/github.errors'
import { GitHubService } from '../../src/effects/services/github/github.service'
import { createTaskProcedure } from '../../src/orpc/api/tasks/create'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('api/tasks/create GitHub import', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let otherOrganizationId: string
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
	const userId = 'user_github_task_create'
	const connectionId = '019f536c-b021-763a-84b2-bbd8ee8e2914'
	const repositoryId = '90071992547409931236'
	const canonicalRepositoryFullName = 'acme/web'

	beforeAll(async () => {
		const testDb = await createTestDb('tasks_create_github')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const insertedOrganizations = await db
			.insert(organizations)
			.values([
				{ name: 'GitHub task org', workos_organization_id: `workos-${randomUUID()}` },
				{ name: 'Other GitHub task org', workos_organization_id: `workos-${randomUUID()}` },
			])
			.returning()
		const primaryOrganization = insertedOrganizations[0]
		const otherOrganization = insertedOrganizations[1]
		if (!primaryOrganization || !otherOrganization) throw new Error('Unable to create test organizations')
		organizationId = primaryOrganization.id
		otherOrganizationId = otherOrganization.id
		await db.insert(onlineHosts).values({
			host_id: 'github-test-host',
			user_id: userId,
			organization_id: organizationId,
		})

		runtime = createRuntimeWithTestPostgresLayer(db, {
			github: makeGitHubServiceLayer({ organizationId, connectionId, repositoryId, canonicalRepositoryFullName }),
		})
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDb?.()
	}, 30_000)

	const context = (requestedOrganizationId = organizationId) =>
		createMockApiContext({
			auth: createMockApiAuth({
				userId,
				organizationId: requestedOrganizationId,
				workosOrganizationId: `workos-${requestedOrganizationId}`,
			}),
			services: { db, dbReadReplica: db, effectRuntime: runtime },
		})

	const githubInput = (id = uuidv7()) => ({
		id,
		name: '[acme/web#482] Client preview title',
		slug: `acme-web-482-${id}`,
		ticketProvider: 'github' as const,
		ticketId: '482',
		githubConnectionId: connectionId,
		ticketRepositoryId: repositoryId,
		ticketRepositoryFullName: 'tampered/preview-name',
	})

	test('persists canonical repository fields and authoritative text-only ticket.md atomically', async () => {
		const result = await call(createTaskProcedure, githubInput(), { context: context() })

		expect(result.task).toMatchObject({
			ticket_provider: 'github',
			ticket_id: '482',
			ticket_url: 'https://github.com/acme/web/issues/482',
			ticket_repository_id: repositoryId,
			ticket_repository_full_name: canonicalRepositoryFullName,
		})
		const [ticket] = await db.select().from(artifacts).where(eq(artifacts.task_id, result.task.id))
		expect(ticket).toMatchObject({
			file_name: 'ticket.md',
			storage_type: 'postgres',
			task_slug: result.task.slug,
		})
		expect(ticket?.content).toContain('[#482] Authoritative provider title')
		expect(ticket?.content).toContain('Provider body fetched during creation.')
		expect(ticket?.content).toContain('View on GitHub: https://github.com/acme/web/issues/482')
		expect(ticket?.content).not.toContain('tampered/preview-name')
		expect(ticket?.content).not.toContain('```task-artifact')
		expect(ticket?.content_hash).toBe(hash(ticket?.content))
	})

	test('ignores legacy ticketContent and creates one canonical ticket with the initial session', async () => {
		const result = await call(
			createTaskProcedure,
			{
				...githubInput(),
				ticketContent: '# Legacy client body',
				firstSession: {
					text: 'Start work',
					workingDirectory: '/tmp/acme-web',
					hostId: 'github-test-host',
					codingAgent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissionsMode: 'default',
				},
			},
			{ context: context() },
		)

		const ticketRows = await db.select().from(artifacts).where(eq(artifacts.task_id, result.task.id))
		const sessionRows = await db.select().from(sessions).where(eq(sessions.task_id, result.task.id))
		expect(ticketRows).toHaveLength(1)
		expect(ticketRows[0]?.content).toContain('Authoritative provider title')
		expect(ticketRows[0]?.content).not.toContain('Legacy client body')
		expect(sessionRows).toHaveLength(1)
	})

	test('a V3 prompt creates task.md plus a repository-derived GitHub ticket artifact', async () => {
		const result = await call(
			createTaskProcedure,
			{ ...githubInput(), taskContent: 'Fix the flaky preview.' },
			{ context: context() },
		)

		const rows = await db.select().from(artifacts).where(eq(artifacts.task_id, result.task.id))
		const taskMd = rows.find((row) => row.file_name === 'task.md')
		const ticketMd = rows.find((row) => row.file_name === 'acme-web-482.md')
		expect(rows).toHaveLength(2)
		expect(taskMd?.content).toBe('Fix the flaky preview.\n\nSee [acme/web#482](./acme-web-482.md).')
		expect(ticketMd?.content).toContain('Authoritative provider title')
	})

	test('fails provider preparation before inserting the task', async () => {
		const taskId = uuidv7()
		await expect(
			call(createTaskProcedure, { ...githubInput(taskId), ticketId: '503' }, { context: context() }),
		).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
		expect(await db.select().from(tasks).where(eq(tasks.id, taskId))).toHaveLength(0)
	})

	test('rejects a repository selected through another organization before insertion', async () => {
		const taskId = uuidv7()
		await expect(
			call(createTaskProcedure, githubInput(taskId), { context: context(otherOrganizationId) }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
		expect(await db.select().from(tasks).where(eq(tasks.id, taskId))).toHaveLength(0)
	})

	test('rejects a stale URL whose repository does not match the selected repository', async () => {
		const taskId = uuidv7()
		await expect(
			call(
				createTaskProcedure,
				{ ...githubInput(taskId), ticketId: 'https://github.com/other/repo/issues/482' },
				{ context: context() },
			),
		).rejects.toMatchObject({ code: 'BAD_REQUEST', data: { message: 'repository_mismatch' } })
		expect(await db.select().from(tasks).where(eq(tasks.id, taskId))).toHaveLength(0)
	})

	test('rolls back the task when prepared artifact persistence fails', async () => {
		const taskId = uuidv7()
		await db.insert(artifacts).values({
			task_id: taskId,
			task_slug: 'existing',
			resource_owner_user_id: userId,
			organization_id: organizationId,
			file_name: 'ticket.md',
			content: 'existing',
			content_hash: hash('existing'),
			created_by: userId,
		})

		await expect(call(createTaskProcedure, githubInput(taskId), { context: context() })).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
		})
		expect(await db.select().from(tasks).where(eq(tasks.id, taskId))).toHaveLength(0)
		expect(await db.select().from(artifacts).where(eq(artifacts.task_id, taskId))).toHaveLength(1)
	})
})

const makeGitHubServiceLayer = (input: {
	readonly organizationId: string
	readonly connectionId: string
	readonly repositoryId: string
	readonly canonicalRepositoryFullName: string
}) =>
	Layer.succeed(GitHubService, {
		createInstallUrl: () => Effect.die('createInstallUrl not used'),
		completeInstallation: () => Effect.die('completeInstallation not used'),
		mutatePullRequest: () => Effect.die('mutatePullRequest not used'),
		listConnections: () => Effect.die('listConnections not used'),
		getConnection: () => Effect.die('getConnection not used'),
		listRepositories: () => Effect.die('listRepositories not used'),
		getIssuePreview: () => Effect.die('getIssuePreview not used'),
		prepareIssueImport: (request) => {
			if (request.organizationId !== input.organizationId || request.repositoryId !== input.repositoryId) {
				return Effect.fail(new GitHubRepositoryNotAccessibleError({ repositoryId: request.repositoryId }))
			}
			if (request.connectionId !== input.connectionId) {
				return Effect.fail(new GitHubRepositoryNotAccessibleError({ repositoryId: request.repositoryId }))
			}
			if (request.issueInput === '503') {
				return Effect.fail(new GitHubIntegrationUnavailableError({ cause: 'provider unavailable' }))
			}
			if (request.issueInput.includes('other/repo')) {
				return Effect.fail(new GitHubIssueInputInvalidError({ reason: 'repository_mismatch' }))
			}

			const content = [
				'[#482] Authoritative provider title',
				'State: open',
				'Labels: integration',
				'Assignees: octocat',
				'',
				'Description:',
				'Provider body fetched during creation.',
				'',
				'Comments:',
				'None',
				'',
				`View on GitHub: https://github.com/${input.canonicalRepositoryFullName}/issues/482`,
				'',
			].join('\n')
			return Effect.succeed({
				identity: {
					connectionId: input.connectionId,
					issueNumber: 482,
					repositoryId: input.repositoryId,
					repositoryFullName: input.canonicalRepositoryFullName,
					url: `https://github.com/${input.canonicalRepositoryFullName}/issues/482`,
				},
				ticket: { fileName: 'ticket.md' as const, content, contentHash: hash(content) },
				images: [],
			})
		},
		syncArtifactBacklink: () => Effect.die('syncArtifactBacklink not used'),
		refreshConnection: () => Effect.die('refreshConnection not used'),
		fetchPullRequest: () => Effect.die('fetchPullRequest not used'),
		disconnect: () => Effect.die('disconnect not used'),
		verifyWebhook: () => Effect.die('verifyWebhook not used'),
		handleWebhook: () => Effect.void,
	})
