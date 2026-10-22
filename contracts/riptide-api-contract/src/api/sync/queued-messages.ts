import { queuedMessageSelectSchema } from '@humanlayer/db/tables/queued-messages'

import { contractBuilder } from '../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from './shared-schemas'

export const syncQueuedMessagesContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(queuedMessageSelectSchema))
