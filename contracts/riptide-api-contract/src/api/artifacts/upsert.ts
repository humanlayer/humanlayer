export { UpsertArtifactInputSchema, UpsertArtifactOutputSchema } from '../../daemon/artifacts/upsert'

import { contractBuilder } from '../../contract-builder'
import { UpsertArtifactInputSchema, UpsertArtifactOutputSchema } from '../../daemon/artifacts/upsert'

export const upsertApiArtifactContract = contractBuilder
	.input(UpsertArtifactInputSchema)
	.output(UpsertArtifactOutputSchema)
