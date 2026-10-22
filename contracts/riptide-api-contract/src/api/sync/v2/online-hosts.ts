import { onlineHostSelectSchema } from '@humanlayer/db/tables/online-hosts'

import { contractBuilder } from '../../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from '../shared-schemas'

export const syncV2OnlineHostsContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(onlineHostSelectSchema))
