import { Context, Crypto, type Effect } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import type { ForkMeta, SessionContext } from '@/agents/shared/run-session'
import type { HostUsageLimits } from '@/lib/usage-limits/host-usage-limits'

import type { DaemonApi } from '../daemon-api/daemon-api.service'
import type { DaemonCollections } from '../daemon-collections/daemon-collections.service'
import type { DaemonTaskSync } from '../daemon-task-sync'
import type { DurableStreamFetch } from '../stream-producer/durable-stream-fetch'
import type { GitCommandRunnerRequirements } from '../task-diff/git-command-runner.service'
import type { TaskDiffServiceRegistry } from '../task-diff/task-diff-service-registry.service'
import type { TaskWorkspaceContext } from '../task-workspace-context/task-workspace-context.service'
import type {
	ClaudeExecutionError,
	ClaudeFollowUpDeliveryError,
	ClaudeSessionsShuttingDownError,
} from './claude-session-errors'
import type { ClaudeSdk } from './sdk/claude-sdk-session.service'

type ClaudeExecutionDependencies =
	| ClaudeSdk
	| Crypto.Crypto
	| DaemonApi
	| DaemonCollections
	| DaemonTaskSync
	| DurableStreamFetch
	| FileSystem.FileSystem
	| Path.Path
	| TaskDiffServiceRegistry
	| TaskWorkspaceContext
	| GitCommandRunnerRequirements
	| HostUsageLimits

export interface ExecuteClaudeSessionInput {
	readonly context: SessionContext
	readonly setupArtifactPaths: (
		cwd: string,
		taskId: string,
		taskSlug: string,
	) => Promise<{ storagePath: string; symlinkPath: string }>
	readonly resumeSessionId?: string
	readonly forkMeta?: ForkMeta
}

export type ClaudeFollowUpDeliveryOutcome = 'accepted' | 'not-active' | 'closed' | 'shutting-down'

export interface DeliverClaudeFollowUpMessageInput {
	readonly sessionId: string
	readonly prompt: string
}

export interface StopClaudeSessionInput {
	readonly sessionId: string
	readonly reason?: 'archive' | 'delete' | 'explicit'
}

export type StopClaudeSessionOutcome = 'not-active' | 'already-stopping' | 'stopped' | 'timed-out'

export class ClaudeSessions extends Context.Service<
	ClaudeSessions,
	{
		readonly executeClaudeSession: (
			input: ExecuteClaudeSessionInput,
		) => Effect.Effect<void, ClaudeExecutionError | ClaudeSessionsShuttingDownError, ClaudeExecutionDependencies>
		readonly deliverFollowUpMessage: (
			input: DeliverClaudeFollowUpMessageInput,
		) => Effect.Effect<ClaudeFollowUpDeliveryOutcome, ClaudeFollowUpDeliveryError, DaemonApi>
		readonly stopClaudeSession: (input: StopClaudeSessionInput) => Effect.Effect<StopClaudeSessionOutcome>
		readonly shutdownActiveClaudeSessions: Effect.Effect<void>
		/** Sessions with an open or starting SDK process, including ones idle between turns. */
		readonly activeSessionIds: Effect.Effect<ReadonlyArray<string>>
	}
>()('ClaudeSessions') {}
