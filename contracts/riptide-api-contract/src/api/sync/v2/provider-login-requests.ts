import { providerLoginRequestSelectSchema } from '@humanlayer/db/tables/provider-login-requests'

import { contractBuilder } from '../../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from '../shared-schemas'

export const syncV2ProviderLoginRequestsContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(providerLoginRequestSelectSchema))
