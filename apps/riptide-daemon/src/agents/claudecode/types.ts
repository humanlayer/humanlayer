import type { RiptideDaemonApiContract } from '@humanlayer/riptide-api-contract/contract-router'
import type { ContractRouterClient } from '@orpc/contract'

import type { ApprovalsCollection } from '@/collections/electric/approvals'
import type { ProviderLoginRequestsCollection } from '@/collections/electric/provider-login-requests'
import type { SessionsCollection } from '@/collections/electric/sessions'
import type { TasksCollection } from '@/collections/electric/tasks'
import type { WorkspaceSetupCollection } from '@/collections/electric/workspace-setup'
import type { DaemonRuntime } from '@/effects/runtime'
import type { RepositoryObserver } from '@/lib/git/repository-observer'
import type { ISyncService } from '@/lib/sync-service'
import type { AutomationLifecycleCoordinator } from '@/lifecycle/automation-lifecycle'

import type { SessionExecutor } from '../shared/run-session'
import type { ShutdownCoordinator } from './shutdown'

export type { EffectiveSettings } from './effective-settings'
// Re-export EffectiveSettings from standalone file (no path alias deps for external imports)
export { DEFAULT_EFFECTIVE_SETTINGS } from './effective-settings'

/**
 * Type alias for the ORPC client used by the daemon.
 * Tests can use `Partial<ORPCClient>` + cast for mock construction.
 */
export type ORPCClient = ContractRouterClient<typeof RiptideDaemonApiContract>

/**
 * Injectable dependencies for the session runner and related functions.
 * Groups all stateful dependencies that were previously module-level singletons.
 */
export interface DaemonServices {
	/** App-wide Effect runtime seam owned by daemon startup and shutdown. */
	daemonRuntime: DaemonRuntime

	/** oRPC client for API calls (status updates, event creation) */
	orpc: ORPCClient

	/** Sync proxy origin used by streaming and Electric collections */
	syncOrigin?: string

	/** Daemon token used for sync proxy authorization */
	daemonToken?: string

	/** Restricts this daemon process to one prepared automation session. */
	automationTargetSessionId?: string

	/** Coordinates bounded activity and completion for the automation target. */
	automationLifecycle?: AutomationLifecycleCoordinator

	/** TanStack DB collections for session and approval data */
	collections: {
		sessions: SessionsCollection
		approvals: ApprovalsCollection
		tasks: TasksCollection
		workspaceSetup: WorkspaceSetupCollection
		providerLoginRequests: ProviderLoginRequestsCollection
	}

	/** Shutdown coordination for graceful termination */
	shutdown: ShutdownCoordinator

	/** Sync service for artifact management */
	syncService: ISyncService

	/** Reports the repositories a session works in; absent in tests and one-off tooling. */
	repositoryObserver?: RepositoryObserver

	/** Stable executor registrations; the Claude executor selects a runtime from user settings for each run. */
	executors: {
		claude: SessionExecutor
		codelayer: SessionExecutor
		fold: SessionExecutor
	}

	/** Routes input to Effect sessions when a run selected that runtime and still has a live handle. */
}

/** Services slice for hook factories. Required — session-runner always provides it. */
export type HookServices = Pick<DaemonServices, 'orpc'>
