import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'

import { contractBuilder } from '../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from './shared-schemas'

export const syncSessionsContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(sessionSelectSchema))
