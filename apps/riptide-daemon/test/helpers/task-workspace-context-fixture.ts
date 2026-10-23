import type {
	TaskWorkspaceContext,
	WorkspaceRepository,
	WorkspaceRepositorySetupStage,
	WorkspaceRepositoryStatus,
} from '@humanlayer/schemas/effect/project-workspace'

export const FIXTURE_ORGANIZATION_ID = '01990c8d-0000-7000-8000-000000000001'
export const FIXTURE_PROJECT_ID = '01990c8d-0000-7000-8000-000000000002'
export const FIXTURE_WORKSPACE_ID = '01990c8d-0000-7000-8000-000000000003'
export const FIXTURE_TASK_ID = '01990c8d-0000-7000-8000-000000000004'
export const FIXTURE_USER_ID = 'user-1'
export const FIXTURE_HOST_ID = 'host-1'
export const FIXTURE_BASE_COMMIT = 'a'.repeat(40)

export interface FixtureRepositoryState {
	readonly repositoryIdentity: string
	readonly branch?: string
	readonly default?: boolean
	readonly description?: string
	readonly setupCommand?: string
	readonly status?: WorkspaceRepositorySetupStage
	/** Absolute worktree path once materialized; omit to leave the repository unmaterialized. */
	readonly materializedPath?: string
	readonly resolvedCommit?: string | null
	readonly error?: WorkspaceRepositoryStatus['error']
	readonly acceptedSkips?: WorkspaceRepositoryStatus['acceptedSkips']
	/** Omit the status row entirely (an inconsistent placement). */
	readonly withoutStatusRow?: boolean
	readonly generation?: number
}

export interface MakeTaskWorkspaceContextInput {
	readonly repositories: ReadonlyArray<FixtureRepositoryState>
	/** `~`-prefixed placement root as the API stores it. */
	readonly filePath?: string
	readonly hostId?: string
	readonly userId?: string
	readonly setupGeneration?: number
	readonly placed?: boolean
}

const remoteUrlFor = (repositoryIdentity: string) => `https://${repositoryIdentity}.git`

const snapshotRepository = (state: FixtureRepositoryState): WorkspaceRepository => {
	const repository: WorkspaceRepository = {
		remoteUrl: remoteUrlFor(state.repositoryIdentity),
		repositoryIdentity: state.repositoryIdentity,
		defaultBranch: 'main',
		branch: state.branch ?? 'workspace-branch',
		baseCommit: FIXTURE_BASE_COMMIT,
		default: state.default ?? false,
		autoPushBranch: false,
		copyGlobs: [],
	}
	if (state.description !== undefined) repository.description = state.description
	if (state.setupCommand !== undefined) repository.setupCommand = state.setupCommand
	return repository
}

const statusRow = (
	state: FixtureRepositoryState,
	input: Required<Pick<MakeTaskWorkspaceContextInput, 'hostId' | 'userId'>>,
): WorkspaceRepositoryStatus => ({
	organizationId: FIXTURE_ORGANIZATION_ID,
	projectId: FIXTURE_PROJECT_ID,
	workspaceId: FIXTURE_WORKSPACE_ID,
	userId: input.userId,
	hostId: input.hostId,
	repositoryIdentity: state.repositoryIdentity,
	repositoryRemoteUrl: remoteUrlFor(state.repositoryIdentity),
	status: state.status ?? (state.materializedPath === undefined ? 'checking_source' : 'done'),
	repoAvailable: true,
	sourcePolicy: null,
	sourceKind: 'filesystem',
	sourcePath: `/sources/${state.repositoryIdentity}`,
	resolvedCommit: state.resolvedCommit === undefined ? FIXTURE_BASE_COMMIT : state.resolvedCommit,
	materialization:
		state.materializedPath === undefined
			? null
			: { kind: 'worktree', path: state.materializedPath, branch: state.branch ?? 'workspace-branch' },
	branchPublishStatus: null,
	copyResult: null,
	setupCommandResult: null,
	acceptedSkips: state.acceptedSkips === undefined ? [] : [...state.acceptedSkips],
	error: state.error ?? null,
	generation: state.generation ?? 1,
	currentBranch: null,
	localHead: null,
	remoteHead: null,
	aheadCount: null,
	behindCount: null,
	dirty: null,
	gitStateCheckedAt: null,
	createdAt: 1,
	updatedAt: 1,
})

/** A project-workspace task context as the daemon API returns it for one user/host. */
export function makeTaskWorkspaceContext(input: MakeTaskWorkspaceContextInput): TaskWorkspaceContext {
	const hostId = input.hostId ?? FIXTURE_HOST_ID
	const userId = input.userId ?? FIXTURE_USER_ID
	const repositories = input.repositories.map(snapshotRepository)
	if (!repositories.some((repository) => repository.default) && repositories[0] !== undefined) {
		repositories[0].default = true
	}
	return {
		taskId: FIXTURE_TASK_ID,
		workspace: {
			id: FIXTURE_WORKSPACE_ID,
			organizationId: FIXTURE_ORGANIZATION_ID,
			projectId: FIXTURE_PROJECT_ID,
			name: 'fixture workspace',
			description: null,
			createdBy: userId,
			resourceOwnerUserId: userId,
			repositories,
			archived: false,
			createdAt: 1,
			updatedAt: 1,
		},
		materialization:
			input.placed === false
				? null
				: {
						location: {
							organizationId: FIXTURE_ORGANIZATION_ID,
							projectId: FIXTURE_PROJECT_ID,
							workspaceId: FIXTURE_WORKSPACE_ID,
							userId,
							hostId,
							filePath: input.filePath ?? `~/.humanlayer/workspaces/${FIXTURE_WORKSPACE_ID}`,
							setupGeneration: input.setupGeneration ?? 1,
							createdAt: 1,
							updatedAt: 1,
						},
						repositories: input.repositories
							.filter((state) => state.withoutStatusRow !== true)
							.map((state) => statusRow(state, { hostId, userId })),
					},
	}
}
