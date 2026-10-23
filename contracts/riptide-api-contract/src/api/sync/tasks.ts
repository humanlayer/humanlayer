import { taskSelectSchema } from '@humanlayer/db/tables/tasks'

import { contractBuilder } from '../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from './shared-schemas'

export const syncTasksContract = contractBuilder.input(SyncInputSchema).output(createSyncOutputSchema(taskSelectSchema))
