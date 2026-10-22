import { Context } from 'effect'

import type { WorkspaceSetupServiceShape } from './workspace-setup.types'

/** Public workspace setup application service. */
export class WorkspaceSetupService extends Context.Service<WorkspaceSetupService, WorkspaceSetupServiceShape>()(
	'WorkspaceSetupService',
) {}
