import type {
	RepositorySourceCandidate,
	SessionWorkspaceSetup,
	TaskWorkspaceContext,
	TaskWorkspaceMaterialization,
	WorkspaceBranchPublishStatus,
	WorkspaceFileCopyResult,
	WorkspaceLocation,
	WorkspaceRepositoryActorSnapshot,
	WorkspaceRepositoryAcceptedSkip,
	WorkspaceRepositoryGitState,
	WorkspaceRepositorySetupError,
	WorkspaceRepositorySetupResult,
	WorkspaceRepositorySetupStage,
	WorkspaceRepositorySourceKind,
	WorkspaceRepositorySourcePolicy,
	WorkspaceRepositoryStatus,
	WorkspaceRepositoryStatusIdentity,
	WorkspaceSetupCommandResult,
	WorkspaceSnapshot,
	WorktreeMaterialization,
} from '@humanlayer/schemas/effect/project-workspace/workspace-repository-status'
import z from 'zod/v4'

import { NormalizedRepositoryIdentitySchema } from './project-recipe'
import { GitCommitShaSchema, WorkspaceRepositoriesSchema, WorkspaceRepositorySchema } from './workspace-recipe'

const nonNegativeInteger = z.number().int().nonnegative()
const positiveInteger = z.number().int().positive()

export const WORKSPACE_REPOSITORY_SETUP_STAGES = [
	'setup_requested',
	'checking_source',
	'cloning_source',
	'refreshing_source',
	'resolving_commit',
	'materializing',
	'publishing_branch',
	'copying_files',
	'running_setup_command',
	'done',
] as const
export const WorkspaceRepositorySetupStageSchema = z.enum(WORKSPACE_REPOSITORY_SETUP_STAGES)

export const WORKSPACE_REPOSITORY_SOURCE_KINDS = ['filesystem', 'managed_clone'] as const
export const WorkspaceRepositorySourceKindSchema = z.enum(WORKSPACE_REPOSITORY_SOURCE_KINDS)

export const WORKSPACE_REPOSITORY_SOURCE_POLICIES = ['filesystem_required', 'managed_clone'] as const
export const WorkspaceRepositorySourcePolicySchema = z.enum(WORKSPACE_REPOSITORY_SOURCE_POLICIES)

export const RepositorySourceCandidateSchema = z.object({
	sourceKind: WorkspaceRepositorySourceKindSchema,
	sourcePath: z.string().min(1),
})

export const WORKSPACE_BRANCH_PUBLISH_STATUSES = ['published', 'warning'] as const
export const WorkspaceBranchPublishStatusSchema = z.enum(WORKSPACE_BRANCH_PUBLISH_STATUSES)

export const WorktreeMaterializationSchema = z.object({
	kind: z.literal('worktree'),
	path: z.string().min(1),
	branch: z.string().min(1),
})

export const WorkspaceFileCopyResultSchema = z.object({
	copiedFiles: z.array(z.string().min(1)),
	completedAt: nonNegativeInteger,
})

export const WorkspaceSetupCommandResultSchema = z.object({
	command: z.string(),
	exitCode: z.number().int(),
	stdoutLogPath: z.string().min(1).nullable(),
	stderrLogPath: z.string().min(1).nullable(),
	completedAt: nonNegativeInteger,
})

export const WorkspaceRepositorySetupErrorSchema = z.object({
	stage: WorkspaceRepositorySetupStageSchema,
	message: z.string().min(1),
	command: z.string().optional(),
	exitCode: z.number().int().optional(),
	stderr: z.string().optional(),
	stdoutLogPath: z.string().min(1).optional(),
	stderrLogPath: z.string().min(1).optional(),
})

export const WorkspaceRepositoryAcceptedSkipSchema = z.object({
	stage: z.enum(['copying_files', 'running_setup_command']),
	message: z.string().min(1),
	skippedByUserId: z.string().min(1),
	skippedAt: nonNegativeInteger,
})

export const WorkspaceRepositoryGitStateSchema = z.object({
	currentBranch: z.string().min(1).nullable(),
	localHead: GitCommitShaSchema.nullable(),
	remoteHead: GitCommitShaSchema.nullable(),
	aheadCount: nonNegativeInteger,
	behindCount: nonNegativeInteger,
	dirty: z.boolean(),
	checkedAt: nonNegativeInteger,
})

export const WorkspaceSnapshotSchema = z.object({
	id: z.uuid(),
	organizationId: z.uuid(),
	projectId: z.uuid(),
	name: z.string().min(1),
	description: z.string().nullable(),
	createdBy: z.string().min(1),
	resourceOwnerUserId: z.string().min(1),
	repositories: WorkspaceRepositoriesSchema,
	archived: z.boolean(),
	createdAt: nonNegativeInteger,
	updatedAt: nonNegativeInteger,
})

export const WorkspaceLocationSchema = z.object({
	organizationId: z.uuid(),
	projectId: z.uuid(),
	workspaceId: z.uuid(),
	userId: z.string().min(1),
	hostId: z.string().min(1),
	filePath: z.string().min(1),
	setupGeneration: positiveInteger,
	createdAt: nonNegativeInteger,
	updatedAt: nonNegativeInteger,
})

export const WorkspaceRepositoryStatusSchema = z.object({
	organizationId: z.uuid(),
	projectId: z.uuid(),
	workspaceId: z.uuid(),
	userId: z.string().min(1),
	hostId: z.string().min(1),
	repositoryIdentity: NormalizedRepositoryIdentitySchema,
	repositoryRemoteUrl: z.string().min(1),
	status: WorkspaceRepositorySetupStageSchema,
	repoAvailable: z.boolean(),
	sourcePolicy: WorkspaceRepositorySourcePolicySchema.nullable(),
	sourceKind: WorkspaceRepositorySourceKindSchema.nullable(),
	sourcePath: z.string().min(1).nullable(),
	resolvedCommit: GitCommitShaSchema.nullable(),
	materialization: WorktreeMaterializationSchema.nullable(),
	branchPublishStatus: WorkspaceBranchPublishStatusSchema.nullable(),
	copyResult: WorkspaceFileCopyResultSchema.nullable(),
	setupCommandResult: WorkspaceSetupCommandResultSchema.nullable(),
	acceptedSkips: z.array(WorkspaceRepositoryAcceptedSkipSchema),
	error: WorkspaceRepositorySetupErrorSchema.nullable(),
	generation: positiveInteger,
	currentBranch: z.string().min(1).nullable(),
	localHead: GitCommitShaSchema.nullable(),
	remoteHead: GitCommitShaSchema.nullable(),
	aheadCount: nonNegativeInteger.nullable(),
	behindCount: nonNegativeInteger.nullable(),
	dirty: z.boolean().nullable(),
	gitStateCheckedAt: nonNegativeInteger.nullable(),
	createdAt: nonNegativeInteger,
	updatedAt: nonNegativeInteger,
})

export const WorkspaceRepositoryStatusIdentitySchema = z.object({
	projectId: z.uuid(),
	workspaceId: z.uuid(),
	repositoryIdentity: NormalizedRepositoryIdentitySchema,
})

export const WorkspaceRepositoryActorSnapshotSchema = z.object({
	workspace: WorkspaceSnapshotSchema,
	repository: WorkspaceRepositorySchema,
	location: WorkspaceLocationSchema,
	status: WorkspaceRepositoryStatusSchema,
	sourceCandidates: z.array(RepositorySourceCandidateSchema),
})

export const SessionWorkspaceSetupSchema = z.object({
	sessionId: z.uuid(),
	taskId: z.uuid(),
	workspace: WorkspaceSnapshotSchema,
	location: WorkspaceLocationSchema,
	repositories: z.array(WorkspaceRepositoryActorSnapshotSchema),
	defaultRepositoryIdentity: NormalizedRepositoryIdentitySchema,
	defaultRepositoryMaterializationPath: z.string().min(1).nullable(),
})

export const TaskWorkspaceMaterializationSchema = z.object({
	location: WorkspaceLocationSchema,
	repositories: z.array(WorkspaceRepositoryStatusSchema),
})

export const TaskWorkspaceContextSchema = z.object({
	taskId: z.uuid(),
	workspace: WorkspaceSnapshotSchema,
	materialization: TaskWorkspaceMaterializationSchema.nullable(),
})

// _tag discriminator mirrors the Effect TaggedUnion wire format; Zod is required here because oRPC contracts consume these schemas.
export const WorkspaceRepositorySetupResultSchema = z.discriminatedUnion('_tag', [
	z.object({ _tag: z.literal('SetupStarted') }),
	z.object({ _tag: z.literal('ManagedCloneRequested'), sourcePath: z.string().min(1) }),
	z.object({
		_tag: z.literal('SourceChecked'),
		repoAvailable: z.boolean(),
		sourceKind: WorkspaceRepositorySourceKindSchema,
		sourcePath: z.string().min(1),
	}),
	z.object({
		_tag: z.literal('SourceRefreshed'),
		sourceKind: WorkspaceRepositorySourceKindSchema,
		sourcePath: z.string().min(1),
	}),
	z.object({ _tag: z.literal('ManagedCloneReady'), sourcePath: z.string().min(1) }),
	z.object({ _tag: z.literal('CommitResolved'), resolvedCommit: GitCommitShaSchema }),
	z.object({ _tag: z.literal('WorktreeMaterialized'), materialization: WorktreeMaterializationSchema }),
	z.object({ _tag: z.literal('BranchPublishFinished'), status: WorkspaceBranchPublishStatusSchema }),
	z.object({ _tag: z.literal('FilesCopied'), result: WorkspaceFileCopyResultSchema }),
	z.object({ _tag: z.literal('SetupCommandFinished'), result: WorkspaceSetupCommandResultSchema }),
	z.object({
		_tag: z.literal('StageFailed'),
		stage: WorkspaceRepositorySetupStageSchema,
		error: WorkspaceRepositorySetupErrorSchema,
	}),
	z.object({ _tag: z.literal('GitStateObserved'), state: WorkspaceRepositoryGitStateSchema }),
])

export type {
	RepositorySourceCandidate,
	SessionWorkspaceSetup,
	TaskWorkspaceContext,
	TaskWorkspaceMaterialization,
	WorkspaceBranchPublishStatus,
	WorkspaceFileCopyResult,
	WorkspaceLocation,
	WorkspaceRepositoryActorSnapshot,
	WorkspaceRepositoryAcceptedSkip,
	WorkspaceRepositoryGitState,
	WorkspaceRepositorySetupError,
	WorkspaceRepositorySetupResult,
	WorkspaceRepositorySetupStage,
	WorkspaceRepositorySourceKind,
	WorkspaceRepositorySourcePolicy,
	WorkspaceRepositoryStatus,
	WorkspaceRepositoryStatusIdentity,
	WorkspaceSetupCommandResult,
	WorkspaceSnapshot,
	WorktreeMaterialization,
}
