import { taskUserAclSelectSchema } from '@humanlayer/db/tables/task-user-acl'

import { contractBuilder } from '../../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from '../shared-schemas'

export const syncV2TaskUserAclsContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(taskUserAclSelectSchema))
