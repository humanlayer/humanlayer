import type {
	TaskDiffFileBaselineRowType,
	TaskDiffFileRowType,
	TaskDiffFileVersionRowType,
	TaskDiffWorkspaceType,
} from '@humanlayer/streams/diff'
import { Schema } from 'effect'

export type TaskDiffWorkspace = TaskDiffWorkspaceType
export type TaskDiffRepoContext = TaskDiffWorkspaceType['repos'][number] & {
	readonly organizationId: TaskDiffWorkspaceType['organizationId']
	readonly taskId: TaskDiffWorkspaceType['taskId']
	readonly hostId: TaskDiffWorkspaceType['hostId']
	readonly workspaceBaseDirectory: string
	readonly sessionId: string
}

export type TaskDiffBaseResolution =
	| { readonly commit: string; readonly strategy: 'source_commit' }
	| { readonly commit: string; readonly strategy: 'source_ref'; readonly resolvedRef: string }
	| {
			readonly commit: string
			readonly strategy: 'alternate_remote'
			readonly configuredSourceRef: string
			readonly resolvedRef: string
	  }
	| { readonly commit: string; readonly strategy: 'head_reflog' }
	| { readonly commit: string; readonly strategy: 'root_commit' }

export const TaskRepoLockKey = Schema.String.pipe(Schema.brand('TaskRepoLockKey'))
export type TaskRepoLockKey = typeof TaskRepoLockKey.Type

export const makeTaskRepoLockKey = (taskId: string, repoId: string): TaskRepoLockKey =>
	Schema.decodeUnknownSync(TaskRepoLockKey)(`${taskId}:${repoId}`)

export type TaskDiffCaptureMode = 'full' | 'incremental'

export interface TaskDiffCaptureRequirements {
	/** `full` publishes every baseline and current version; `incremental` only what changed. */
	readonly versionMode: TaskDiffCaptureMode
	readonly replaceFileProjection: boolean
}

export interface TaskDiffPublication {
	readonly mode: TaskDiffCaptureMode
	readonly replaceFileProjection: boolean
	/** Task-start bodies, upserted by `fileKey`. */
	readonly baselines: ReadonlyArray<TaskDiffFileBaselineRowType>
	/** Immutable bodies, keyed by `versionId`. */
	readonly versions: ReadonlyArray<TaskDiffFileVersionRowType>
	/** Every current file row; a full file-projection replacement inserts all of them. */
	readonly files: ReadonlyArray<TaskDiffFileRowType>
	readonly inserts: ReadonlyArray<TaskDiffFileRowType>
	readonly updates: ReadonlyArray<TaskDiffFileRowType>
	readonly deletes: ReadonlyArray<string>
}

export interface PendingCapture {
	readonly publication: TaskDiffPublication
	readonly candidateIndexPath: string
	readonly candidateBasePath: string
	readonly previousStateDirectory?: string
	readonly repo: TaskDiffRepoContext
}

export interface GitOutput {
	readonly stdout: string
	readonly stderr: string
	readonly exitCode: number
}

export interface TaskDiffCaptureRequest {
	readonly taskId: string
	readonly sessionId: string
}

export interface TaskDiffTaskLifecycleState {
	readonly taskId: string
	readonly archived: boolean
}

export interface TaskDiffWorkspaceLifecycleState {
	readonly taskId: string
	readonly workspace: TaskDiffWorkspace | undefined
}

export interface TaskDiffLifecycleInitialState {
	readonly tasks: ReadonlyArray<TaskDiffTaskLifecycleState>
	readonly workspaces: ReadonlyArray<TaskDiffWorkspaceLifecycleState>
}
