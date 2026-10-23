import { taskUserSettingsSelectSchema } from '@humanlayer/db/tables/task-user-settings'

import { contractBuilder } from '../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from './shared-schemas'

export const syncTaskUserSettingsContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(taskUserSettingsSelectSchema))
