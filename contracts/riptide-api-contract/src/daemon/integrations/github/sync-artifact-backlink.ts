import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const SyncGitHubArtifactBacklinkInputSchema = z.object({
	taskId: z.uuid(),
})

export const SyncGitHubArtifactBacklinkOutputSchema = z.object({
	synced: z.boolean(),
})

export const syncGitHubArtifactBacklinkContract = contractBuilder
	.input(SyncGitHubArtifactBacklinkInputSchema)
	.output(SyncGitHubArtifactBacklinkOutputSchema)
