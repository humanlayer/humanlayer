import type { WorkspaceView } from '@humanlayer/db/utils/workspace-view'
import type { WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import { Effect } from 'effect'

import { resolveTaskWorkspaceView } from '@/effects/workspace-setup/resolve-task-workspace'
import {
	projectWorkspaceViewFromContext,
	renderProjectWorkspaceSetupProgress,
} from '@/lib/workspace/project-workspace-view'

import { DaemonTaskWorkspaceContextError } from '../daemon-api/daemon-api.errors'
import { TaskWorkspaceContext } from './task-workspace-context.service'

export interface SessionWorkspaceTaskRow {
	readonly id: string
	/** Set for project-workspace tasks; those never carry legacy workspace JSON. */
	readonly workspace_id?: string | null
	readonly workspace_spec?: unknown
	readonly workspace_state?: WorkspaceState | null
}

export interface SessionWorkspaceSetupRow {
	readonly id: string
	readonly task_id: string
	readonly host_id: string
	readonly resolved_workspace_spec?: unknown
	readonly workspace_setup_state?: unknown
	readonly error?: unknown
}

/**
 * `launch` reads authoritative project-workspace state for a session that is about to run;
 * `tracking` accepts the recently read state so periodic loops stay cheap.
 */
export type SessionWorkspaceFreshness = 'launch' | 'tracking'

export interface ResolveSessionWorkspaceViewInput {
	readonly task: SessionWorkspaceTaskRow
	readonly hostId: string
	readonly setupRows: readonly SessionWorkspaceSetupRow[]
	readonly freshness: SessionWorkspaceFreshness
}

export interface SessionWorkspaceResolution {
	readonly view: WorkspaceView | null
	/** The `<workspace_setup_status>` block for a project workspace; legacy tasks render their own. */
	readonly setupProgress: string | null
}

const noWorkspace: SessionWorkspaceResolution = { view: null, setupProgress: null }

export const isProjectWorkspaceTask = (task: Pick<SessionWorkspaceTaskRow, 'workspace_id'>): boolean =>
	task.workspace_id !== undefined && task.workspace_id !== null

/** Present the authoritative task context to consumers that understand the legacy view shape. */
export const resolveProjectWorkspaceView = Effect.fn('task_workspace_context.resolve_project_workspace_view')(
	function* (input: { readonly taskId: string; readonly freshness: SessionWorkspaceFreshness }) {
		const contexts = yield* TaskWorkspaceContext
		const read =
			input.freshness === 'launch' ? contexts.loadTaskWorkspaceContext : contexts.recentTaskWorkspaceContext
		const context = yield* read({ taskId: input.taskId })
		if (input.freshness === 'launch' && (context === null || context.materialization === null)) {
			return yield* new DaemonTaskWorkspaceContextError({
				taskId: input.taskId,
				cause: new Error('Project workspace context is unavailable for this daemon placement'),
			})
		}
		if (context === null) return noWorkspace
		return {
			view: projectWorkspaceViewFromContext(context),
			setupProgress: renderProjectWorkspaceSetupProgress(context),
		} satisfies SessionWorkspaceResolution
	},
)

/**
 * One entry point for every session runtime and tracker that needs a task's repositories. A
 * project-workspace task resolves through the authoritative task context for this user/host and
 * never reads legacy workspace JSON; any other task keeps the synced legacy resolution unchanged.
 * Parse failures on either path degrade to no workspace view, as the legacy readers always did.
 */
export const resolveSessionWorkspaceView = Effect.fn('task_workspace_context.resolve_session_workspace_view')(
	function* (input: ResolveSessionWorkspaceViewInput) {
		if (isProjectWorkspaceTask(input.task)) {
			return yield* resolveProjectWorkspaceView({ taskId: input.task.id, freshness: input.freshness })
		}
		const view = yield* resolveTaskWorkspaceView({
			task: input.task,
			hostId: input.hostId,
			setupRows: input.setupRows,
		}).pipe(
			Effect.catchTags({
				InvalidWorkspaceSpecError: () => Effect.succeed(null),
				InvalidWorkspaceSetupStateError: () => Effect.succeed(null),
				InvalidWorkspaceSetupErrorError: () => Effect.succeed(null),
			}),
		)
		return { view, setupProgress: null } satisfies SessionWorkspaceResolution
	},
)
