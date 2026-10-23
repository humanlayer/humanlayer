import { taskOrganizationAclSelectSchema } from '@humanlayer/db/tables/task-organization-acl'

import { contractBuilder } from '../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from './shared-schemas'

export const syncTaskOrganizationAclsContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(taskOrganizationAclSelectSchema))
