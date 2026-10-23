import type {
	WorkspaceRepositoryActorSnapshot,
	WorkspaceRepositorySetupStage,
} from '@humanlayer/schemas/effect/project-workspace'
import { Effect } from 'effect'

import type { WorkspaceRepositoryActorOperationsService } from '@/effects/services/workspace-repository-actor-operations/workspace-repository-actor-operations.service'

export const remainingWorkspaceSetupOperationStubs = {
	cloneSource: (snapshot) => Effect.succeed(snapshot),
	publishBranch: (snapshot) => Effect.succeed(snapshot),
	copyFiles: (snapshot) => Effect.succeed(snapshot),
	runSetupCommand: (snapshot) => Effect.succeed(snapshot),
} satisfies Pick<
	WorkspaceRepositoryActorOperationsService,
	'cloneSource' | 'publishBranch' | 'copyFiles' | 'runSetupCommand'
>

export const workspaceRepositorySnapshotAt = (
	status: WorkspaceRepositorySetupStage,
	updatedAt = 1,
): WorkspaceRepositoryActorSnapshot => ({
	sourceCandidates: [{ sourceKind: 'filesystem', sourcePath: '/tmp/source' }],
	workspace: {
		id: '01990c8d-0000-7000-8000-000000000003',
		organizationId: '01990c8d-0000-7000-8000-000000000001',
		projectId: '01990c8d-0000-7000-8000-000000000002',
		name: 'test workspace',
		description: null,
		createdBy: 'user-1',
		resourceOwnerUserId: 'user-1',
		repositories: [
			{
				remoteUrl: 'https://github.com/humanlayer/syncopate.git',
				repositoryIdentity: 'github.com/humanlayer/syncopate',
				defaultBranch: 'main',
				branch: 'workspace-test',
				default: true,
				autoPushBranch: false,
				copyGlobs: [],
			},
		],
		archived: false,
		createdAt: 1,
		updatedAt: 1,
	},
	repository: {
		remoteUrl: 'https://github.com/humanlayer/syncopate.git',
		repositoryIdentity: 'github.com/humanlayer/syncopate',
		defaultBranch: 'main',
		branch: 'workspace-test',
		default: true,
		autoPushBranch: false,
		copyGlobs: [],
	},
	location: {
		organizationId: '01990c8d-0000-7000-8000-000000000001',
		projectId: '01990c8d-0000-7000-8000-000000000002',
		workspaceId: '01990c8d-0000-7000-8000-000000000003',
		userId: 'user-1',
		hostId: 'host-1',
		filePath: '/tmp/workspace',
		setupGeneration: 1,
		createdAt: 1,
		updatedAt: 1,
	},
	status: {
		organizationId: '01990c8d-0000-7000-8000-000000000001',
		projectId: '01990c8d-0000-7000-8000-000000000002',
		workspaceId: '01990c8d-0000-7000-8000-000000000003',
		userId: 'user-1',
		hostId: 'host-1',
		repositoryIdentity: 'github.com/humanlayer/syncopate',
		repositoryRemoteUrl: 'https://github.com/humanlayer/syncopate.git',
		status,
		repoAvailable: status !== 'setup_requested' && status !== 'checking_source',
		sourcePolicy: null,
		sourceKind: 'filesystem',
		sourcePath: '/tmp/source',
		resolvedCommit: status === 'materializing' || status === 'done' ? 'a'.repeat(40) : null,
		materialization:
			status === 'done' ? { kind: 'worktree', path: '/tmp/workspace', branch: 'workspace-test' } : null,
		branchPublishStatus: null,
		copyResult: null,
		setupCommandResult: null,
		acceptedSkips: [],
		error: null,
		generation: 1,
		currentBranch: null,
		localHead: null,
		remoteHead: null,
		aheadCount: null,
		behindCount: null,
		dirty: null,
		gitStateCheckedAt: null,
		createdAt: 1,
		updatedAt,
	},
})
