import { artifactCommentSelectSchema } from '@humanlayer/db/tables/artifact-comments'

import { contractBuilder } from '../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from './shared-schemas'

export const syncArtifactCommentsContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(artifactCommentSelectSchema))
