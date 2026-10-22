import type { Session } from '@humanlayer/db/tables/sessions'
import type { TaskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { Effect } from 'effect'

import type { DaemonServices } from '@/agents/claudecode/types'
import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import {
	parseWorkspaceSetupError,
	parseWorkspaceSetupState,
	parseWorkspaceSpecForSetup,
} from '@/effects/workspace-setup/parse-workspace-setup'
import { convergeWorkspace } from '@/lib/workspace/converge'
import {
	summarizeWorkspaceSetupProgressForDisplay,
	workspaceSetupStateAllowsSessionLaunch,
	workspaceSetupForTaskOnHostHasCompleted,
} from '@/lib/workspace/ledger'
import logger from '@/logger'

export interface WorkspaceSetupJoinedRow {
	session: Session
	workspaceSetup: TaskWorkspaceSetupForHost | undefined
}

export interface HandleWorkspaceSetupEventInput {
	readonly session: Session
	readonly workspaceSetup: TaskWorkspaceSetupForHost
	readonly workspaceSpec: unknown
}

export const handleWorkspaceSetupEvent = (input: HandleWorkspaceSetupEventInput) =>
	Effect.gen(function* () {
		const { session, workspaceSetup } = input
		const context = {
			taskId: workspaceSetup.task_id,
			hostId: workspaceSetup.host_id,
			rowId: workspaceSetup.id,
		}
		const workspaceSpec = yield* parseWorkspaceSpecForSetup(
			{
				resolvedWorkspaceSpec: workspaceSetup.resolved_workspace_spec,
				taskWorkspaceSpec: input.workspaceSpec,
			},
			context,
		)
		const setupState = yield* parseWorkspaceSetupState(workspaceSetup.workspace_setup_state, context)
		const progress = summarizeWorkspaceSetupProgressForDisplay(setupState)
		const attributes = {
			session_id: session.id,
			task_id: workspaceSetup.task_id,
			host_id: workspaceSetup.host_id,
			setup_row_id: workspaceSetup.id,
			session_status: session.status,
			setup_status: workspaceSetup.status,
		}

		if (workspaceSetup.error !== null) {
			yield* parseWorkspaceSetupError(workspaceSetup.error, context)
			yield* Effect.logInfo('Workspace setup row is parked on an error').pipe(
				Effect.annotateLogs({ ...attributes, progress, decision_reason: 'setup_row_parked_on_error' }),
			)
			return
		}

		if (workspaceSetupForTaskOnHostHasCompleted(setupState)) {
			yield* Effect.logDebug('Workspace setup already completed').pipe(
				Effect.annotateLogs({ ...attributes, progress, decision_reason: 'setup_already_completed' }),
			)
			return
		}

		const launchAllowed = workspaceSetupStateAllowsSessionLaunch(setupState, workspaceSpec)
		if (!launchAllowed && session.status === 'ready_for_launch') {
			const api = yield* DaemonApi
			yield* api.updateSession({ sessionId: session.id, status: 'waiting_for_workspace' })
			yield* Effect.logInfo('Session moved to waiting_for_workspace').pipe(
				Effect.annotateLogs({ ...attributes, progress, decision_reason: 'workspace_launch_gate_blocked' }),
			)
		} else {
			yield* Effect.logDebug('Workspace convergence continuing without a session claim').pipe(
				Effect.annotateLogs({
					...attributes,
					progress,
					decision_reason: launchAllowed ? 'workspace_launch_gate_cleared' : 'session_already_acknowledged',
				}),
			)
		}

		yield* convergeWorkspace({
			spec: workspaceSpec,
			setupRowId: workspaceSetup.id,
			setupState,
			taskId: workspaceSetup.task_id,
			sessionId: session.id,
			hostId: workspaceSetup.host_id,
		})
	}).pipe(
		Effect.withSpan('workspace_setup.handle_event', {
			attributes: {
				session_id: input.session.id,
				task_id: input.workspaceSetup.task_id,
				host_id: input.workspaceSetup.host_id,
				setup_row_id: input.workspaceSetup.id,
			},
		}),
	)

/** Mechanical TanStack callback adapter. Actor decisions stay in the Effect program above. */
export async function handleWorkspaceSetup(row: WorkspaceSetupJoinedRow, services: DaemonServices): Promise<void> {
	const { session, workspaceSetup } = row
	const baseFields = {
		sessionId: session.id,
		taskId: session.task_id,
		hostId: session.host_id,
		sessionStatus: session.status,
		setupRowId: workspaceSetup?.id,
		setupStatus: workspaceSetup?.status,
	}
	logger.debug(baseFields, 'Workspace setup joined event received')

	if (!workspaceSetup) {
		logger.debug({ ...baseFields, decisionReason: 'setup_row_not_synced' }, 'Workspace setup row is not actionable')
		return
	}
	const task = session.task_id
		? services.collections.tasks.toArray.find((candidate) => candidate.id === session.task_id)
		: undefined
	if (task?.workspace_spec == null) {
		logger.debug(
			{ ...baseFields, decisionReason: 'workspace_spec_missing' },
			'Workspace setup row is not actionable',
		)
		return
	}

	await services.daemonRuntime.runPromise(
		handleWorkspaceSetupEvent({ session, workspaceSetup, workspaceSpec: task.workspace_spec }),
	)
}
