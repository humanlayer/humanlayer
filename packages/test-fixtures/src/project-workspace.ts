import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { projects } from '@humanlayer/db/tables/projects'
import { repositoryLocationsForUserForHost } from '@humanlayer/db/tables/repository-locations-for-user-for-host'
import { workspaceLocationsForUserForHost } from '@humanlayer/db/tables/workspace-locations-for-user-for-host'
import { workspaceRepositoryStatusForUserForHost } from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { workspaces } from '@humanlayer/db/tables/workspaces'
import type { WorkspaceRepository, WorkspaceRepositorySetupStage } from '@humanlayer/schemas/effect/project-workspace'
import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

export interface FilesystemWorkspaceFixtureRepository {
	readonly remoteUrl: string
	readonly repositoryIdentity: string
	readonly sourcePath: string
	readonly defaultBranch?: string
	readonly branch?: string
	readonly default?: boolean
	readonly baseCommit?: string
	readonly autoPushBranch?: boolean
	readonly copyGlobs?: ReadonlyArray<string>
	readonly setupCommand?: string
}

export interface CreateFilesystemWorkspaceActorFixtureInput {
	readonly organizationId?: string
	readonly projectId?: string
	readonly workspaceId?: string
	readonly userId?: string
	readonly hostId?: string
	readonly targetRoot: string
	readonly repositories: ReadonlyArray<FilesystemWorkspaceFixtureRepository>
	readonly status?: WorkspaceRepositorySetupStage
	readonly generation?: number
	readonly archived?: boolean
}

type MutableWorkspaceRepository = {
	-readonly [Key in keyof WorkspaceRepository]: WorkspaceRepository[Key]
}

export async function createFilesystemWorkspaceActorFixture(
	db: PostgresJsDatabase,
	input: CreateFilesystemWorkspaceActorFixtureInput,
) {
	if (input.repositories.length === 0) throw new Error('Workspace actor fixture requires a repository')
	const organizationId = input.organizationId ?? randomUUID()
	const projectId = input.projectId ?? randomUUID()
	const workspaceId = input.workspaceId ?? randomUUID()
	const userId = input.userId ?? `user-${randomUUID()}`
	const hostId = input.hostId ?? `host-${randomUUID()}`
	const generation = input.generation ?? 1
	const now = Date.now()
	const defaultCount = input.repositories.filter((repository) => repository.default === true).length
	const repositories: WorkspaceRepository[] = input.repositories.map((repository, index) => {
		const configuredRepository: MutableWorkspaceRepository = {
			remoteUrl: repository.remoteUrl,
			repositoryIdentity: repository.repositoryIdentity,
			defaultBranch: repository.defaultBranch ?? 'main',
			branch: repository.branch ?? `workspace-${workspaceId.slice(0, 8)}`,
			default: defaultCount === 0 ? index === 0 : repository.default === true,
			autoPushBranch: repository.autoPushBranch ?? false,
			copyGlobs: [...(repository.copyGlobs ?? [])],
		}
		if (repository.baseCommit !== undefined) configuredRepository.baseCommit = repository.baseCommit
		if (repository.setupCommand !== undefined) configuredRepository.setupCommand = repository.setupCommand
		return configuredRepository
	})
	const projectRepositories = repositories.map(
		({ branch: _branch, baseCommit: _baseCommit, ...repository }) => repository,
	)
	const repositoryPaths = Object.fromEntries(
		input.repositories.map((repository) => [repository.repositoryIdentity, repository.sourcePath]),
	)

	await db.transaction(async (tx) => {
		await tx.insert(organizations).values({
			id: organizationId,
			name: 'Workspace actor fixture',
			workos_organization_id: `workos-${organizationId}`,
		})
		await tx.insert(projects).values({
			id: projectId,
			organization_id: organizationId,
			name: 'Workspace actor fixture project',
			created_by: userId,
			resource_owner_user_id: userId,
			repositories: projectRepositories,
		})
		await tx.insert(repositoryLocationsForUserForHost).values(
			input.repositories.map((repository) => ({
				organization_id: organizationId,
				user_id: userId,
				host_id: hostId,
				repository_identity: repository.repositoryIdentity,
				source_path: repository.sourcePath,
				source_kind: 'filesystem' as const,
				selection_order: sql`nextval('repository_location_selection_order')`,
			})),
		)
		await tx.insert(workspaces).values({
			id: workspaceId,
			organization_id: organizationId,
			project_id: projectId,
			name: 'Workspace actor fixture workspace',
			created_by: userId,
			resource_owner_user_id: userId,
			repositories,
			archived: input.archived ?? false,
		})
		await tx.insert(workspaceLocationsForUserForHost).values({
			organization_id: organizationId,
			project_id: projectId,
			workspace_id: workspaceId,
			user_id: userId,
			host_id: hostId,
			file_path: input.targetRoot,
			setup_generation: BigInt(generation),
		})
		await tx.insert(workspaceRepositoryStatusForUserForHost).values(
			repositories.map((repository, index) => ({
				organization_id: organizationId,
				project_id: projectId,
				workspace_id: workspaceId,
				user_id: userId,
				host_id: hostId,
				repository_identity: repository.repositoryIdentity,
				repository_remote_url: repository.remoteUrl,
				status: input.status ?? 'setup_requested',
				repo_available: false,
				source_kind: 'filesystem' as const,
				source_path: input.repositories[index]!.sourcePath,
				resolved_commit: repository.baseCommit ?? null,
				generation: BigInt(generation),
				created_at: BigInt(now + index),
				updated_at: BigInt(now + index),
			})),
		)
	})

	return {
		organizationId,
		projectId,
		workspaceId,
		userId,
		hostId,
		targetRoot: input.targetRoot,
		repositories,
		repositoryPaths,
	}
}
