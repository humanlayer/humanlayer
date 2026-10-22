export { DaemonCreateUploadInputSchema, DaemonCreateUploadOutputSchema } from '../../daemon/artifacts/create-upload'

import { contractBuilder } from '../../contract-builder'
import { DaemonCreateUploadInputSchema, DaemonCreateUploadOutputSchema } from '../../daemon/artifacts/create-upload'

export const createUploadArtifactContract = contractBuilder
	.input(DaemonCreateUploadInputSchema)
	.output(DaemonCreateUploadOutputSchema)
