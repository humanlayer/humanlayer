import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { projects } from '@humanlayer/db/tables/projects'
import { taskSelectSchema, tasks } from '@humanlayer/db/tables/tasks'
import { workspaceLocationsForUserForHost } from '@humanlayer/db/tables/workspace-locations-for-user-for-host'
import {
	workspaceRepositoryStatusForUserForHost,
	workspaceRepositoryStatusInsertSchema,
	workspaceRepositoryStatusSelectSchema,
} from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { workspaceSelectSchema, workspaces } from '@humanlayer/db/tables/workspaces'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const projectRepository = {
	remoteUrl: 'git@github.com:humanlayer/syncopate.git',
	repositoryIdentity: 'github.com/humanlayer/syncopate',
	defaultBranch: 'main',
	default: true,
	autoPushBranch: false,
	copyGlobs: [],
}

const workspaceRepository = {
	...projectRepository,
	branch: 'workspace/phase-3',
}

describe('project workspace relational schema', () => {
	let db: PostgresJsDatabase
	let cleanup: (() => Promise<void>) | undefined

	beforeAll(async () => {
		const testDb = await createTestDb('project-workspace-schema')
		db = testDb.db
		cleanup = testDb.cleanup
	}, 60_000)

	afterAll(async () => {
		await cleanup?.()
	}, 30_000)

	async function createOrganization(name: string) {
		const id = randomUUID()
		await db.insert(organizations).values({ id, name, workos_organization_id: `workos-${id}` })
		return id
	}

	async function createProject(organizationId: string, name: string) {
		const id = randomUUID()
		await db.insert(projects).values({
			id,
			organization_id: organizationId,
			name,
			created_by: 'user-owner',
			resource_owner_user_id: 'user-owner',
			repositories: [projectRepository],
		})
		return id
	}

	async function createWorkspace(organizationId: string, projectId: string, name = 'Workspace') {
		const id = randomUUID()
		await db.insert(workspaces).values({
			id,
			organization_id: organizationId,
			project_id: projectId,
			name,
			created_by: 'user-owner',
			resource_owner_user_id: 'user-owner',
			repositories: [workspaceRepository],
		})
		return id
	}

	test('references workspace graph entities through their id columns', async () => {
		const firstOrganizationId = await createOrganization('First organization')
		const firstProjectId = await createProject(firstOrganizationId, 'First project')
		const workspaceId = await createWorkspace(firstOrganizationId, firstProjectId)

		await expect(
			db.insert(workspaces).values({
				organization_id: firstOrganizationId,
				project_id: randomUUID(),
				name: 'Workspace with missing project',
				created_by: 'user-owner',
				resource_owner_user_id: 'user-owner',
				repositories: [workspaceRepository],
			}),
		).rejects.toMatchObject({
			cause: { code: '23503' },
		})

		await expect(
			db.insert(workspaceLocationsForUserForHost).values({
				organization_id: firstOrganizationId,
				project_id: firstProjectId,
				workspace_id: randomUUID(),
				user_id: 'user-owner',
				host_id: 'host-one',
				file_path: '/tmp/workspaces/phase-3',
			}),
		).rejects.toMatchObject({
			cause: { code: '23503' },
		})

		await db.insert(workspaceLocationsForUserForHost).values({
			organization_id: firstOrganizationId,
			project_id: firstProjectId,
			workspace_id: workspaceId,
			user_id: 'user-owner',
			host_id: 'host-one',
			file_path: '/tmp/workspaces/phase-3',
		})

		await db.insert(workspaceRepositoryStatusForUserForHost).values({
			organization_id: firstOrganizationId,
			project_id: firstProjectId,
			workspace_id: workspaceId,
			user_id: 'user-owner',
			host_id: 'host-one',
			repository_identity: workspaceRepository.repositoryIdentity,
			repository_remote_url: workspaceRepository.remoteUrl,
		})
	})

	test('enforces repository status identity uniqueness and validates stage vocabulary at the schema boundary', async () => {
		const organizationId = await createOrganization('Status organization')
		const projectId = await createProject(organizationId, 'Status project')
		const workspaceId = await createWorkspace(organizationId, projectId)
		const location = {
			organization_id: organizationId,
			project_id: projectId,
			workspace_id: workspaceId,
			user_id: 'user-owner',
			host_id: 'host-status',
			file_path: '/tmp/workspaces/status',
		}
		await db.insert(workspaceLocationsForUserForHost).values(location)
		const status = {
			organization_id: organizationId,
			project_id: projectId,
			workspace_id: workspaceId,
			user_id: location.user_id,
			host_id: location.host_id,
			repository_identity: workspaceRepository.repositoryIdentity,
			repository_remote_url: workspaceRepository.remoteUrl,
		}
		await db.insert(workspaceRepositoryStatusForUserForHost).values(status)

		await expect(db.insert(workspaceRepositoryStatusForUserForHost).values(status)).rejects.toMatchObject({
			cause: {
				code: '23505',
				constraint_name: 'workspace_repository_status_for_user_for_host_pk',
			},
		})

		expect(
			workspaceRepositoryStatusInsertSchema.safeParse({
				...status,
				repository_identity: 'github.com/humanlayer/agentlayer',
				repository_remote_url: 'https://github.com/humanlayer/agentlayer.git',
				status: 'invalid_stage',
			}).success,
		).toBe(false)
	})

	test('allows several tasks to reference one workspace and keeps legacy task rows unchanged', async () => {
		const organizationId = await createOrganization('Task cardinality organization')
		const projectId = await createProject(organizationId, 'Task cardinality project')
		const workspaceId = await createWorkspace(organizationId, projectId)

		const insertedTasks = await db
			.insert(tasks)
			.values([
				{
					organization_id: organizationId,
					project_id: projectId,
					workspace_id: workspaceId,
					name: 'First workspace task',
					created_by: 'user-owner',
					resource_owner_user_id: 'user-owner',
				},
				{
					organization_id: organizationId,
					project_id: projectId,
					workspace_id: workspaceId,
					name: 'Second workspace task',
					created_by: 'user-owner',
					resource_owner_user_id: 'user-owner',
				},
			])
			.returning()
		expect(insertedTasks).toHaveLength(2)
		expect(insertedTasks.every((task) => task.workspace_id === workspaceId)).toBe(true)

		const [legacyTask] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Legacy task',
				created_by: 'user-owner',
				resource_owner_user_id: 'user-owner',
			})
			.returning()
		const parsedLegacyTask = taskSelectSchema.parse(legacyTask)
		expect(parsedLegacyTask.project_id).toBeNull()
		expect(parsedLegacyTask.workspace_id).toBeNull()
		expect(taskSelectSchema.shape.workspace_id.safeParse(null).success).toBe(true)
	})

	test('parses workspace and repository-status JSON fields at database boundaries', async () => {
		const organizationId = await createOrganization('JSON parsing organization')
		const projectId = await createProject(organizationId, 'JSON parsing project')
		const workspaceId = await createWorkspace(organizationId, projectId)
		const [workspace] = await db.select().from(workspaces)
		expect(
			workspaceSelectSchema.safeParse({ ...workspace, repositories: JSON.stringify([workspaceRepository]) })
				.success,
		).toBe(true)
		expect(workspaceSelectSchema.safeParse({ ...workspace, repositories: '[]' }).success).toBe(false)

		await db.insert(workspaceLocationsForUserForHost).values({
			organization_id: organizationId,
			project_id: projectId,
			workspace_id: workspaceId,
			user_id: 'user-owner',
			host_id: 'host-json',
			file_path: '/tmp/workspaces/json',
		})
		const [status] = await db
			.insert(workspaceRepositoryStatusForUserForHost)
			.values({
				organization_id: organizationId,
				project_id: projectId,
				workspace_id: workspaceId,
				user_id: 'user-owner',
				host_id: 'host-json',
				repository_identity: workspaceRepository.repositoryIdentity,
				repository_remote_url: workspaceRepository.remoteUrl,
				materialization: {
					kind: 'worktree',
					path: '/tmp/workspaces/json/syncopate',
					branch: 'workspace/phase-3',
				},
			})
			.returning()
		expect(
			workspaceRepositoryStatusSelectSchema.safeParse({
				...status,
				materialization: JSON.stringify(status?.materialization),
				accepted_skips: JSON.stringify([]),
			}).success,
		).toBe(true)
		expect(
			workspaceRepositoryStatusSelectSchema.safeParse({
				...status,
				materialization: JSON.stringify({ kind: 'clone', path: '/tmp/not-a-worktree', branch: 'main' }),
			}).success,
		).toBe(false)
	})
})
