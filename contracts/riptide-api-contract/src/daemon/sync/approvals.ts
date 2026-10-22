import { approvalSelectSchema } from '@humanlayer/db/tables/approvals'

import { createSyncOutputSchema, SyncInputSchema } from '../../api/sync/shared-schemas'
import { contractBuilder } from '../../contract-builder'

/**
 * Input schema for the daemon approvals sync route.
 *
 * Uses SyncInputSchema directly (no additional hostId field).
 * The handler derives hostId from context.auth.hostId, which comes from
 * the daemon token — there is no IDOR risk since the host cannot request
 * another host's approvals.
 */
export const syncDaemonApprovalsContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(approvalSelectSchema))
