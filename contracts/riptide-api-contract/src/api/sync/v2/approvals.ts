import { approvalSelectSchema } from '@humanlayer/db/tables/approvals'

import { contractBuilder } from '../../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from '../shared-schemas'

export const syncV2ApprovalsContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(approvalSelectSchema))
