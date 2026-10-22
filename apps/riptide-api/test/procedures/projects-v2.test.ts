import { randomUUID } from 'node:crypto'

import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { projects } from '@humanlayer/db/tables/projects'
import { repositoryLocationsForUserForHost } from '@humanlayer/db/tables/repository-locations-for-user-for-host'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { ORPCError } from '@orpc/client'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { archiveProjectV2Procedure as liveArchiveProject } from '../../src/orpc/api/projects-v2/archive.effect'
import { createProjectV2Procedure as liveCreateProject } from '../../src/orpc/api/projects-v2/create.effect'
import { getProjectV2Procedure as liveGetProject } from '../../src/orpc/api/projects-v2/get.effect'
import { listProjectsV2Procedure as liveListProjects } from '../../src/orpc/api/projects-v2/list.effect'
import { upsertProjectV2LocationProcedure as liveUpsertProjectLocation } from '../../src/orpc/api/projects-v2/location-upsert.effect'
import { updateProjectV2Procedure as liveUpdateProject } from '../../src/orpc/api/projects-v2/update.effect'
import { createMockApiContext, createMockStripeService, createMockWorkosService } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const repository = {
	remoteUrl: 'git@github.com:humanlayer/syncopate.git',
	repositoryIdentity: 'github.com/humanlayer/syncopate',
	defaultBranch: 'main',
	default: true,
	autoPushBranch: false,
	copyGlobs: [],
}

describe('projects v2', () => {
	let db: PostgresJsDatabase
	let cleanup: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let createProject: typeof liveCreateProject
	let getProject: typeof liveGetProject
	let updateProject: typeof liveUpdateProject
	let archiveProject: typeof liveArchiveProject
	let listProjects: typeof liveListProjects
	let upsertProjectLocation: typeof liveUpsertProjectLocation

	const services = {
		workos: createMockWorkosService(),
		stripe: createMockStripeService(),
		get db() {
			return db
		},
		get dbReadReplica() {
			return db
		},
	}

	beforeAll(async () => {
		const testDb = await createTestDb('projects-v2')
		db = testDb.db
		cleanup = testDb.cleanup
		runtime = createRuntimeWithTestPostgresLayer(db)
		createProject = bindProcedureToRuntime(liveCreateProject, runtime)
		getProject = bindProcedureToRuntime(liveGetProject, runtime)
		updateProject = bindProcedureToRuntime(liveUpdateProject, runtime)
		archiveProject = bindProcedureToRuntime(liveArchiveProject, runtime)
		listProjects = bindProcedureToRuntime(liveListProjects, runtime)
		upsertProjectLocation = bindProcedureToRuntime(liveUpsertProjectLocation, runtime)
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanup?.()
	}, 30_000)

	async function setupActor(enabled = true) {
		const organizationId = randomUUID()
		const userId = `user-${randomUUID()}`
		const hostId = `host-${randomUUID()}`
		await db
			.insert(organizations)
			.values({ id: organizationId, name: 'Project test', workos_organization_id: `workos-${organizationId}` })
		await db
			.insert(userSettings)
			.values({ organization_id: organizationId, user_id: userId, projects_v2_enabled: enabled })
		await db
			.insert(onlineHosts)
			.values({ organization_id: organizationId, user_id: userId, host_id: hostId, status: 'online' })
		const auth = {
			userId,
			organizationId,
			workosOrganizationId: `workos-${organizationId}`,
			role: '',
			roles: [] as string[],
			permissions: [] as string[],
			entitlements: [] as string[],
			sessionId: 'session',
		}
		return { organizationId, userId, hostId, context: createMockApiContext({ auth, services }) }
	}

	test('atomically creates a path-free recipe and exact user-host location', async () => {
		const actor = await setupActor()
		const result = await call(
			createProject,
			{
				name: 'Syncopate',
				description: 'Main repository',
				private: false,
				hostId: actor.hostId,
				repositories: [repository],
				repositoryPaths: { [repository.repositoryIdentity]: '/Users/test/syncopate' },
			},
			{ context: actor.context },
		)

		expect(result.project.repositories[0]?.remoteUrl).toBe(repository.remoteUrl)
		expect(JSON.stringify(result.project)).not.toContain('/Users/test/syncopate')
		expect(result.location).not.toBeNull()
		if (!result.location) throw new Error('Expected project location')
		expect(result.location.repositoryPaths).toEqual({ [repository.repositoryIdentity]: '/Users/test/syncopate' })
		const projectRows = await db.select().from(projects).where(eq(projects.id, result.project.id))
		const locationRows = await db
			.select()
			.from(repositoryLocationsForUserForHost)
			.where(eq(repositoryLocationsForUserForHost.organization_id, actor.organizationId))
		expect(projectRows).toHaveLength(1)
		expect(locationRows).toHaveLength(1)
	})

	test('rejects creation while the user flag is off without partial rows', async () => {
		const actor = await setupActor(false)
		await expect(
			call(
				createProject,
				{
					name: 'Disabled',
					private: false,
					hostId: actor.hostId,
					repositories: [repository],
					repositoryPaths: { [repository.repositoryIdentity]: '/tmp/repo' },
				},
				{ context: actor.context },
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
		const rows = await db.select().from(projects).where(eq(projects.organization_id, actor.organizationId))
		expect(rows).toHaveLength(0)
	})

	test('rejects an incomplete initial location at the wire adapter without creating rows', async () => {
		const actor = await setupActor()
		for (const location of [
			{ hostId: actor.hostId },
			{ repositoryPaths: { [repository.repositoryIdentity]: '/tmp/repository' } },
		]) {
			await expect(
				call(
					createProject,
					{ name: 'Incomplete location', private: false, repositories: [repository], ...location },
					{ context: actor.context },
				),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' })
		}
		expect(await db.select().from(projects).where(eq(projects.organization_id, actor.organizationId))).toEqual([])
		expect(
			await db
				.select()
				.from(repositoryLocationsForUserForHost)
				.where(eq(repositoryLocationsForUserForHost.organization_id, actor.organizationId)),
		).toEqual([])
	})

	test('creates a managed-clone recipe without a local host or location', async () => {
		const actor = await setupActor()
		const result = await call(
			createProject,
			{
				name: 'Managed project',
				private: false,
				repositories: [repository],
			},
			{ context: actor.context },
		)

		expect(result.location).toBeNull()
		expect(
			await db
				.select()
				.from(repositoryLocationsForUserForHost)
				.where(eq(repositoryLocationsForUserForHost.organization_id, actor.organizationId)),
		).toHaveLength(0)
	})

	test('accepts partial local mappings and rejects mappings for repositories outside the project', async () => {
		const actor = await setupActor()
		const secondRepository = {
			...repository,
			remoteUrl: 'https://github.com/humanlayer/agentlayer.git',
			repositoryIdentity: 'github.com/humanlayer/agentlayer',
			default: false,
		}
		const created = await call(
			createProject,
			{
				name: 'Partial paths',
				private: false,
				repositories: [repository, secondRepository],
			},
			{ context: actor.context },
		)
		const result = await call(
			upsertProjectLocation,
			{
				projectId: created.project.id,
				hostId: actor.hostId,
				repositoryPaths: { [repository.repositoryIdentity]: '/tmp/syncopate' },
			},
			{ context: actor.context },
		)
		expect(result.location.repositoryPaths).toEqual({
			[repository.repositoryIdentity]: '/tmp/syncopate',
		})

		await expect(
			call(
				upsertProjectLocation,
				{
					projectId: created.project.id,
					hostId: actor.hostId,
					repositoryPaths: { 'github.com/other/repo': '/tmp/other' },
				},
				{ context: actor.context },
			),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })
	})

	test('hides private projects from non-owners while preserving owner-only mutations', async () => {
		const owner = await setupActor()
		const created = await call(
			createProject,
			{
				name: 'Private recipe',
				private: true,
				hostId: owner.hostId,
				repositories: [repository],
				repositoryPaths: { [repository.repositoryIdentity]: '/tmp/private' },
			},
			{ context: owner.context },
		)
		const collaboratorId = `user-${randomUUID()}`
		await db
			.insert(userSettings)
			.values({ organization_id: owner.organizationId, user_id: collaboratorId, projects_v2_enabled: true })
		const collaboratorContext = createMockApiContext({
			auth: {
				userId: collaboratorId,
				organizationId: owner.organizationId,
				workosOrganizationId: `workos-${owner.organizationId}`,
				role: '',
				roles: [],
				permissions: [],
				entitlements: [],
				sessionId: 'session',
			},
			services,
		})
		const visible = await call(listProjects, { archived: false }, { context: collaboratorContext })
		expect(visible.projects.map((project) => project.id)).not.toContain(created.project.id)
		await expect(
			call(getProject, { projectId: created.project.id }, { context: collaboratorContext }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
		await expect(
			call(updateProject, { projectId: created.project.id, name: 'Stolen' }, { context: collaboratorContext }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
	})

	test('lets organization members read shared projects', async () => {
		const owner = await setupActor()
		const created = await call(
			createProject,
			{ name: 'Shared recipe', private: false, repositories: [repository] },
			{ context: owner.context },
		)
		const collaboratorId = `user-${randomUUID()}`
		await db
			.insert(userSettings)
			.values({ organization_id: owner.organizationId, user_id: collaboratorId, projects_v2_enabled: true })
		const collaboratorContext = createMockApiContext({
			auth: {
				userId: collaboratorId,
				organizationId: owner.organizationId,
				workosOrganizationId: `workos-${owner.organizationId}`,
				role: '',
				roles: [],
				permissions: [],
				entitlements: [],
				sessionId: 'session',
			},
			services,
		})

		const visible = await call(listProjects, { archived: false }, { context: collaboratorContext })
		expect(visible.projects.map((project) => project.id)).toContain(created.project.id)
		await expect(
			call(getProject, { projectId: created.project.id }, { context: collaboratorContext }),
		).resolves.toMatchObject({
			project: { id: created.project.id },
		})
	})

	test('archives by tombstone and retains project and location rows', async () => {
		const actor = await setupActor()
		const created = await call(
			createProject,
			{
				name: 'Archive me',
				private: false,
				hostId: actor.hostId,
				repositories: [repository],
				repositoryPaths: { [repository.repositoryIdentity]: '/tmp/archive' },
			},
			{ context: actor.context },
		)
		await call(archiveProject, { projectId: created.project.id, archived: true }, { context: actor.context })
		const [row] = await db
			.select()
			.from(projects)
			.where(and(eq(projects.organization_id, actor.organizationId), eq(projects.id, created.project.id)))
		expect(row?.archived).toBe(true)
		expect(
			await db
				.select()
				.from(repositoryLocationsForUserForHost)
				.where(eq(repositoryLocationsForUserForHost.organization_id, actor.organizationId)),
		).toHaveLength(1)
	})
})
