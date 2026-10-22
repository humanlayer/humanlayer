import { taskWorkspaceSetupForHostSelectSchema } from '@humanlayer/db/tables/task-workspace-setup-for-host'

import { contractBuilder } from '../../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from '../shared-schemas'

export const syncV2TaskWorkspaceSetupForHostContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(taskWorkspaceSetupForHostSelectSchema))
