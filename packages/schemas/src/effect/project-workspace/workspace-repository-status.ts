import { Struct } from 'effect'
import * as Schema from 'effect/Schema'

import { NormalizedRepositoryIdentity } from './project-recipe'
import { GitCommitSha, WorkspaceRepositories, WorkspaceRepository } from './workspace-recipe'

const UUID = Schema.String.check(Schema.isUUID())
const NonNegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0))

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
export const WorkspaceRepositorySetupStage = Schema.Literals(WORKSPACE_REPOSITORY_SETUP_STAGES)
export type WorkspaceRepositorySetupStage = typeof WorkspaceRepositorySetupStage.Type

export const WORKSPACE_REPOSITORY_SOURCE_KINDS = ['filesystem', 'managed_clone'] as const
export const WorkspaceRepositorySourceKind = Schema.Literals(WORKSPACE_REPOSITORY_SOURCE_KINDS)
export type WorkspaceRepositorySourceKind = typeof WorkspaceRepositorySourceKind.Type

export const WORKSPACE_REPOSITORY_SOURCE_POLICIES = ['filesystem_required', 'managed_clone'] as const
export const WorkspaceRepositorySourcePolicy = Schema.Literals(WORKSPACE_REPOSITORY_SOURCE_POLICIES)
export type WorkspaceRepositorySourcePolicy = typeof WorkspaceRepositorySourcePolicy.Type

export const RepositorySourceCandidate = Schema.Struct({
	sourceKind: WorkspaceRepositorySourceKind,
	sourcePath: Schema.NonEmptyString,
})
export interface RepositorySourceCandidate extends Schema.Schema.Type<typeof RepositorySourceCandidate> {}

export const WORKSPACE_BRANCH_PUBLISH_STATUSES = ['published', 'warning'] as const
export const WorkspaceBranchPublishStatus = Schema.Literals(WORKSPACE_BRANCH_PUBLISH_STATUSES)
export type WorkspaceBranchPublishStatus = typeof WorkspaceBranchPublishStatus.Type

export const WorktreeMaterialization = Schema.Struct({
	kind: Schema.Literal('worktree'),
	path: Schema.NonEmptyString,
	branch: Schema.NonEmptyString,
}).mapFields(Struct.map(Schema.mutableKey))
export type WorktreeMaterialization = typeof WorktreeMaterialization.Type

export const WorkspaceFileCopyResult = Schema.Struct({
	copiedFiles: Schema.Array(Schema.NonEmptyString).pipe(Schema.mutable),
	completedAt: NonNegativeInteger,
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceFileCopyResult = typeof WorkspaceFileCopyResult.Type

export const WorkspaceSetupCommandResult = Schema.Struct({
	command: Schema.String,
	exitCode: Schema.Int,
	stdoutLogPath: Schema.NullOr(Schema.NonEmptyString),
	stderrLogPath: Schema.NullOr(Schema.NonEmptyString),
	completedAt: NonNegativeInteger,
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceSetupCommandResult = typeof WorkspaceSetupCommandResult.Type

export const WorkspaceRepositorySetupError = Schema.Struct({
	stage: WorkspaceRepositorySetupStage,
	message: Schema.NonEmptyString,
	command: Schema.optionalKey(Schema.String),
	exitCode: Schema.optionalKey(Schema.Int),
	stderr: Schema.optionalKey(Schema.String),
	stdoutLogPath: Schema.optionalKey(Schema.NonEmptyString),
	stderrLogPath: Schema.optionalKey(Schema.NonEmptyString),
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceRepositorySetupError = typeof WorkspaceRepositorySetupError.Type

export const WorkspaceRepositoryAcceptedSkip = Schema.Struct({
	stage: Schema.Literals(['copying_files', 'running_setup_command']),
	message: Schema.NonEmptyString,
	skippedByUserId: Schema.NonEmptyString,
	skippedAt: NonNegativeInteger,
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceRepositoryAcceptedSkip = typeof WorkspaceRepositoryAcceptedSkip.Type

export const WorkspaceRepositoryGitState = Schema.Struct({
	currentBranch: Schema.NullOr(Schema.NonEmptyString),
	localHead: Schema.NullOr(GitCommitSha),
	remoteHead: Schema.NullOr(GitCommitSha),
	aheadCount: NonNegativeInteger,
	behindCount: NonNegativeInteger,
	dirty: Schema.Boolean,
	checkedAt: NonNegativeInteger,
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceRepositoryGitState = typeof WorkspaceRepositoryGitState.Type

export const WorkspaceSnapshot = Schema.Struct({
	id: UUID,
	organizationId: UUID,
	projectId: UUID,
	name: Schema.NonEmptyString,
	description: Schema.NullOr(Schema.String),
	createdBy: Schema.NonEmptyString,
	resourceOwnerUserId: Schema.NonEmptyString,
	repositories: WorkspaceRepositories,
	archived: Schema.Boolean,
	createdAt: NonNegativeInteger,
	updatedAt: NonNegativeInteger,
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceSnapshot = typeof WorkspaceSnapshot.Type

export const WorkspaceLocation = Schema.Struct({
	organizationId: UUID,
	projectId: UUID,
	workspaceId: UUID,
	userId: Schema.NonEmptyString,
	hostId: Schema.NonEmptyString,
	filePath: Schema.NonEmptyString,
	setupGeneration: PositiveInteger,
	createdAt: NonNegativeInteger,
	updatedAt: NonNegativeInteger,
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceLocation = typeof WorkspaceLocation.Type

export interface WorkspaceMaterializationIdentity {
	readonly userId: string
	readonly hostId: string
}

export const workspaceMaterializationIdentityKey = (identity: WorkspaceMaterializationIdentity): string =>
	`${identity.userId}\0${identity.hostId}`

export const WorkspaceRepositoryStatus = Schema.Struct({
	organizationId: UUID,
	projectId: UUID,
	workspaceId: UUID,
	userId: Schema.NonEmptyString,
	hostId: Schema.NonEmptyString,
	repositoryIdentity: NormalizedRepositoryIdentity,
	repositoryRemoteUrl: Schema.NonEmptyString,
	status: WorkspaceRepositorySetupStage,
	repoAvailable: Schema.Boolean,
	sourcePolicy: Schema.NullOr(WorkspaceRepositorySourcePolicy),
	sourceKind: Schema.NullOr(WorkspaceRepositorySourceKind),
	sourcePath: Schema.NullOr(Schema.NonEmptyString),
	resolvedCommit: Schema.NullOr(GitCommitSha),
	materialization: Schema.NullOr(WorktreeMaterialization),
	branchPublishStatus: Schema.NullOr(WorkspaceBranchPublishStatus),
	copyResult: Schema.NullOr(WorkspaceFileCopyResult),
	setupCommandResult: Schema.NullOr(WorkspaceSetupCommandResult),
	acceptedSkips: Schema.Array(WorkspaceRepositoryAcceptedSkip).pipe(Schema.mutable),
	error: Schema.NullOr(WorkspaceRepositorySetupError),
	generation: PositiveInteger,
	currentBranch: Schema.NullOr(Schema.NonEmptyString),
	localHead: Schema.NullOr(GitCommitSha),
	remoteHead: Schema.NullOr(GitCommitSha),
	aheadCount: Schema.NullOr(NonNegativeInteger),
	behindCount: Schema.NullOr(NonNegativeInteger),
	dirty: Schema.NullOr(Schema.Boolean),
	gitStateCheckedAt: Schema.NullOr(NonNegativeInteger),
	createdAt: NonNegativeInteger,
	updatedAt: NonNegativeInteger,
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceRepositoryStatus = typeof WorkspaceRepositoryStatus.Type

export const WorkspaceRepositoryStatusIdentity = Schema.Struct({
	projectId: UUID,
	workspaceId: UUID,
	repositoryIdentity: NormalizedRepositoryIdentity,
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceRepositoryStatusIdentity = typeof WorkspaceRepositoryStatusIdentity.Type

export const WorkspaceRepositoryActorSnapshot = Schema.Struct({
	workspace: WorkspaceSnapshot,
	repository: WorkspaceRepository,
	location: WorkspaceLocation,
	status: WorkspaceRepositoryStatus,
	sourceCandidates: Schema.Array(RepositorySourceCandidate).pipe(Schema.mutable),
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceRepositoryActorSnapshot = typeof WorkspaceRepositoryActorSnapshot.Type

export const SessionWorkspaceSetup = Schema.Struct({
	sessionId: UUID,
	taskId: UUID,
	workspace: WorkspaceSnapshot,
	location: WorkspaceLocation,
	repositories: Schema.Array(WorkspaceRepositoryActorSnapshot).pipe(Schema.mutable),
	defaultRepositoryIdentity: NormalizedRepositoryIdentity,
	defaultRepositoryMaterializationPath: Schema.NullOr(Schema.NonEmptyString),
}).mapFields(Struct.map(Schema.mutableKey))
export type SessionWorkspaceSetup = typeof SessionWorkspaceSetup.Type

/**
 * One user/host placement of a workspace: the placement record plus the status rows that belong
 * to its current setup generation. Rows from older generations are excluded at the read.
 */
export const TaskWorkspaceMaterialization = Schema.Struct({
	location: WorkspaceLocation,
	repositories: Schema.Array(WorkspaceRepositoryStatus).pipe(Schema.mutable),
}).mapFields(Struct.map(Schema.mutableKey))
export type TaskWorkspaceMaterialization = typeof TaskWorkspaceMaterialization.Type

/**
 * The repository context a daemon needs for every session of one task: the immutable workspace
 * snapshot plus the caller's own user/host materialization. `materialization` is null when this
 * user/host has never placed the workspace; another user's or host's placement is never returned.
 */
export const TaskWorkspaceContext = Schema.Struct({
	taskId: UUID,
	workspace: WorkspaceSnapshot,
	materialization: Schema.NullOr(TaskWorkspaceMaterialization),
}).mapFields(Struct.map(Schema.mutableKey))
export type TaskWorkspaceContext = typeof TaskWorkspaceContext.Type

export const WorkspaceRepositorySetupResult = Schema.TaggedUnion({
	SetupStarted: {},
	ManagedCloneRequested: {
		sourcePath: Schema.NonEmptyString,
	},
	SourceChecked: {
		repoAvailable: Schema.Boolean,
		sourceKind: WorkspaceRepositorySourceKind,
		sourcePath: Schema.NonEmptyString,
	},
	ManagedCloneReady: {
		sourcePath: Schema.NonEmptyString,
	},
	SourceRefreshed: {
		sourceKind: WorkspaceRepositorySourceKind,
		sourcePath: Schema.NonEmptyString,
	},
	CommitResolved: { resolvedCommit: GitCommitSha },
	WorktreeMaterialized: { materialization: WorktreeMaterialization },
	BranchPublishFinished: { status: WorkspaceBranchPublishStatus },
	FilesCopied: { result: WorkspaceFileCopyResult },
	SetupCommandFinished: { result: WorkspaceSetupCommandResult },
	StageFailed: {
		stage: WorkspaceRepositorySetupStage,
		error: WorkspaceRepositorySetupError,
	},
	GitStateObserved: { state: WorkspaceRepositoryGitState },
})
export type WorkspaceRepositorySetupResult = typeof WorkspaceRepositorySetupResult.Type
