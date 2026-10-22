import { taskWorkspaceSetupForHostSelectSchema } from '@humanlayer/db/tables/task-workspace-setup-for-host'

import { createSyncOutputSchema, SyncInputSchema } from '../../api/sync/shared-schemas'
import { contractBuilder } from '../../contract-builder'

export const syncDaemonTaskWorkspaceSetupForHostContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(taskWorkspaceSetupForHostSelectSchema))
