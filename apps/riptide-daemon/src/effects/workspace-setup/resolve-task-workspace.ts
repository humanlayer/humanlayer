import { deriveWorkspaceView, type WorkspaceView } from '@humanlayer/db/utils/workspace-view'
import type { WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import { Effect } from 'effect'

import {
	parseWorkspaceSetupError,
	parseWorkspaceSetupState,
	parseWorkspaceSpec,
	parseWorkspaceSpecForSetup,
} from './parse-workspace-setup'

type TaskWorkspaceShapeInput = {
	readonly id: string
	readonly workspace_spec?: unknown
	readonly workspace_state?: WorkspaceState | null
}

type HostWorkspaceSetupRowInput = {
	readonly id: string
	readonly task_id: string
	readonly host_id: string
	readonly resolved_workspace_spec?: unknown
	readonly workspace_setup_state?: unknown
	readonly error?: unknown
}

type ResolveTaskWorkspaceInput = {
	readonly task: TaskWorkspaceShapeInput
	readonly hostId: string
	readonly setupRows: readonly HostWorkspaceSetupRowInput[]
}

/**
 * Resolves the daemon's setup-aware workspace view for one task and host.
 *
 * New tasks use `workspace_spec` plus the matching host setup row. Legacy tasks
 * without a spec fall back to the deprecated task-level `workspace_state`.
 */
export function resolveTaskWorkspaceView(input: ResolveTaskWorkspaceInput) {
	const setupRow = input.setupRows.find((row) => row.task_id === input.task.id && row.host_id === input.hostId)
	// No spec anywhere is a designed state, not corrupt data: the API writes setup rows with
	// resolved_workspace_spec = null (and an empty ledger) for tasks without a managed workspace,
	// so decoding the null would fail — and report to Sentry — on every read forever.
	if (setupRow?.resolved_workspace_spec == null && input.task.workspace_spec == null) {
		return Effect.succeed(
			deriveWorkspaceView({
				workspaceSpec: null,
				legacyWorkspaceState: input.task.workspace_state,
			}),
		)
	}

	return Effect.gen(function* () {
		if (!setupRow) {
			const workspaceSpec = yield* parseWorkspaceSpec(input.task.workspace_spec, {
				taskId: input.task.id,
				hostId: input.hostId,
			})
			return deriveWorkspaceView({ workspaceSpec })
		}
		const workspaceSpec = yield* parseWorkspaceSpecForSetup(
			{
				resolvedWorkspaceSpec: setupRow.resolved_workspace_spec,
				taskWorkspaceSpec: input.task.workspace_spec,
			},
			{ taskId: input.task.id, hostId: input.hostId, rowId: setupRow.id },
		)

		const workspaceSetupState = yield* parseWorkspaceSetupState(setupRow.workspace_setup_state, {
			taskId: input.task.id,
			hostId: input.hostId,
			rowId: setupRow.id,
		})
		if (setupRow.error != null) {
			yield* parseWorkspaceSetupError(setupRow.error, {
				taskId: input.task.id,
				hostId: input.hostId,
				rowId: setupRow.id,
			})
		}

		return deriveWorkspaceView({ workspaceSpec, workspaceSetupState })
	})
}

/** Resolve a workspace for best-effort readers after parse failures were observed. */
export function resolveTaskWorkspaceViewOrNull(input: ResolveTaskWorkspaceInput): Promise<WorkspaceView | null> {
	return Effect.runPromise(
		resolveTaskWorkspaceView(input).pipe(
			Effect.catchTags({
				InvalidWorkspaceSpecError: () => Effect.succeed(null),
				InvalidWorkspaceSetupStateError: () => Effect.succeed(null),
				InvalidWorkspaceSetupErrorError: () => Effect.succeed(null),
			}),
		),
	)
}
