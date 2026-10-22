import { Context, type Effect } from 'effect'

import type { DaemonTaskCapabilityError } from '@/effects/services/daemon-api/daemon-api.errors'
import type {
	WorkspaceSetupExecutor,
	WorkspaceSetupExecutorRequirements,
} from '@/effects/services/workspace-setup-executor/workspace-setup-executor.service'

export type WorkspaceSetupRunError = DaemonTaskCapabilityError
export type WorkspaceSetupRunRequirements = WorkspaceSetupExecutor | WorkspaceSetupExecutorRequirements

export interface WorkspaceSetupService {
	/** Consume the host-scoped joined stream until the enclosing scope closes. */
	readonly run: Effect.Effect<void, WorkspaceSetupRunError, WorkspaceSetupRunRequirements>
}

export class WorkspaceSetup extends Context.Service<WorkspaceSetup, WorkspaceSetupService>()('WorkspaceSetup') {}
