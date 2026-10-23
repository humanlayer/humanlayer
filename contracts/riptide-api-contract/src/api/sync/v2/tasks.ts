import { taskSelectSchema } from '@humanlayer/db/tables/tasks'

import { contractBuilder } from '../../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from '../shared-schemas'

export const syncV2TasksContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(taskSelectSchema))
