import { artifactSelectSchema } from '@humanlayer/db/tables/artifacts'

import { contractBuilder } from '../../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from '../shared-schemas'

export const syncV2ArtifactsContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(artifactSelectSchema))
