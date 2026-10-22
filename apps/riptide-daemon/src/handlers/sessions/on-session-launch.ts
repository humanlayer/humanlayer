import type { Session } from '@humanlayer/db/tables/sessions'
import {
	CodelayerForkMetadataSchema,
	FoldForkMetadataSchema,
	LegacyClaudeForkMetadataSchema,
} from '@humanlayer/riptide-api-contract/api/sessions/fork'
import {
	CodingAgentZodSchema,
	type LaunchableCodingAgent,
	LaunchableCodingAgentZodSchema,
} from '@humanlayer/schemas/coding-agent'
import type { WorkspaceSetupState, WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
import { Match } from 'effect'
import z from 'zod/v4'

import type { DaemonServices } from '@/agents/claudecode/types'
import {
	type NormalizedForkMeta,
	parseSessionForExecution,
	runSession,
	type SessionExecutor,
} from '@/agents/shared/run-session'
import type { SessionChangeMessage } from '@/collections/types'
import { workspaceSetupStateAllowsSessionLaunch } from '@/lib/workspace/ledger'
import logger from '@/logger'

/**
 * Select the executor for a launchable agent. Exhaustive by design: `Match.exhaustive` stops
 * type-checking the moment a value is added to LAUNCHABLE_CODING_AGENT_VALUES without a branch here,
 * which is what keeps `fold` (and every future agent) from silently falling through to Claude.
 */
const executorForLaunchableAgent = (
	agent: LaunchableCodingAgent,
	executors: DaemonServices['executors'],
): SessionExecutor =>
	Match.value(agent).pipe(
		Match.when('claude', () => executors.claude),
		Match.when('codelayer', () => executors.codelayer),
		Match.when('fold', () => executors.fold),
		Match.exhaustive,
	)

export const ExplicitClaudeForkMetadataSchema = LegacyClaudeForkMetadataSchema.extend({
	agent: CodingAgentZodSchema.extract(['claude']),
})

export const DaemonStoredForkMetadataSchema = z.union([
	ExplicitClaudeForkMetadataSchema,
	CodelayerForkMetadataSchema,
	FoldForkMetadataSchema,
	LegacyClaudeForkMetadataSchema,
])

function normalizeForkMeta(raw: unknown): NormalizedForkMeta | null {
	const fold = FoldForkMetadataSchema.safeParse(raw)
	if (fold.success) return fold.data
	const codelayer = CodelayerForkMetadataSchema.safeParse(raw)
	if (codelayer.success) {
		return {
			agent: 'codelayer',
			sourceSessionId: codelayer.data.sourceSessionId,
			forkAtEventId: codelayer.data.forkAtEventId,
			forkAtRunIndex: codelayer.data.forkAtRunIndex,
			sourceSnapshotRunIndex: codelayer.data.sourceSnapshotRunIndex,
		}
	}
	const claude = LegacyClaudeForkMetadataSchema.safeParse(raw)
	return claude.success ? { agent: 'claude', ...claude.data } : null
}

/**
 * Given a change event, determine if we should handle it as "we need to launch the session"
 */
interface SessionLaunchChange {
	readonly type: 'insert' | 'update' | 'delete'
	readonly value: Session | SessionChangeMessage['value']
}

export function shouldLaunchSession(change: SessionLaunchChange): boolean {
	const session = change.value
	return (
		(change.type === 'update' || change.type === 'insert') &&
		(session.status === 'ready_for_launch' || session.status === 'waiting_for_workspace')
	)
}

export interface WorkspaceLaunchGate {
	workspaceSetupState: WorkspaceSetupState
	workspaceSpec: WorkspaceSpec | null
}

/**
 * Handler for when a session is detected to be launched.
 * Receives DaemonServices via dependency injection from subscriptions.ts.
 */
export async function handleLaunchSession(
	change: SessionLaunchChange,
	services: DaemonServices,
	workspaceLaunchGate?: WorkspaceLaunchGate,
) {
	const session = change.value
	if (!shouldLaunchSession(change)) return
	if (services.automationTargetSessionId !== undefined && session.id !== services.automationTargetSessionId) return
	if (session.task_id !== null) {
		const task = services.collections.tasks.toArray.find((candidate) => candidate.id === session.task_id)
		if (task === undefined) return
		if (workspaceLaunchGate === undefined && task.workspace_spec != null) return
	}

	if (
		workspaceLaunchGate !== undefined &&
		!workspaceSetupStateAllowsSessionLaunch(
			workspaceLaunchGate.workspaceSetupState,
			workspaceLaunchGate.workspaceSpec,
		)
	) {
		logger.debug(
			{ sessionId: session.id, taskId: session.task_id, sessionStatus: session.status },
			'Session launch skipped because workspace launch gate is blocked',
		)
		return
	}

	// Parse the agent against the set the daemon can actually run. Anything outside it — opencode
	// today — is rejected here until its execution path lands. See
	// .humanlayer/tasks/putting-fold-in-humanlayer/06-structure-outline-fold-agent-platform.md.
	const launchableAgent = LaunchableCodingAgentZodSchema.safeParse(session.coding_agent)
	if (!launchableAgent.success) {
		logger.error(
			`Coding agent ${session.coding_agent} is not supported for launching sessions yet (session ${session.id})`,
		)
		await services.orpc.sessions.update({
			sessionId: session.id,
			status: 'failed',
			errorMessage: `The ${session.coding_agent} coding agent is not currently supported.`,
		})
		return
	}

	// Update status to launching before starting
	await services.orpc.sessions.update({
		sessionId: session.id,
		status: 'launching',
	})
	logger.info(`Marked session ${session.id} as launching`)

	// Determine execute function based on coding_agent. Exhaustive so a launchable agent can never
	// fall through to the wrong executor — adding one to LAUNCHABLE_CODING_AGENT_VALUES forces a case here.
	const typedSession = parseSessionForExecution(session)
	if (!typedSession) {
		logger.error({ sessionId: session.id }, 'Received an invalid session from the sync collection')
		await services.orpc.sessions.update({
			sessionId: session.id,
			status: 'failed',
			errorMessage: 'Session data could not be validated before launch.',
		})
		return
	}
	const execute = executorForLaunchableAgent(launchableAgent.data, services.executors)

	// Detect fork: if forked_from_session_id is set, read fork metadata from fork_data
	if (session.forked_from_session_id) {
		const forkData = z.object({ fork: z.unknown() }).safeParse(session.fork_data)
		const rawForkMeta = forkData.success ? forkData.data.fork : null
		if (!rawForkMeta) {
			logger.error({ sessionId: session.id }, 'Forked session missing fork metadata in fork_data')
			await services.orpc.sessions.update({
				sessionId: session.id,
				status: 'failed',
				errorMessage: 'Forked session missing fork metadata',
			})
			return
		}

		const forkMeta = normalizeForkMeta(rawForkMeta)
		if (!forkMeta) {
			logger.error({ sessionId: session.id, forkMeta: rawForkMeta }, 'Forked session has invalid fork metadata')
			await services.orpc.sessions.update({
				sessionId: session.id,
				status: 'failed',
				errorMessage: 'Forked session has invalid fork metadata',
			})
			return
		}

		await runSession({
			session: typedSession,
			forkMeta,
			services,
			execute,
		})
	} else {
		// Run the session (no resumeSessionId = new session)
		await runSession({ session: typedSession, services, execute })
	}
}
