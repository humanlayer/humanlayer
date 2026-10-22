import { approvalSelectSchema } from '@humanlayer/db/tables/approvals'

import { contractBuilder } from '../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from './shared-schemas'

export const syncApprovalsContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(approvalSelectSchema))
