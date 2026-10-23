import { artifactSelectSchema } from '@humanlayer/db/tables/artifacts'
import z from 'zod/v4'

import { createSyncOutputSchema, SyncInputSchema } from '../../api/sync/shared-schemas'
import { contractBuilder } from '../../contract-builder'

/**
 * Input schema for the daemon artifacts sync route.
 *
 * Extends SyncInputSchema with taskId (required). The daemon uses this to
 * fetch artifacts scoped to a specific task, paralleling the Electric proxy
 * /v1/tasks/:taskId/artifacts route.
 *
 * Unlike daemon sessions (which have an IDOR guard), taskId is not sensitive
 * from the daemon token perspective — the ACL WHERE clause ensures the daemon
 * can only see artifacts it has authorization to access for the given task.
 */
export const DaemonSyncArtifactsInputSchema = SyncInputSchema.extend({
	taskId: z.string().uuid(),
})

export type DaemonSyncArtifactsInput = z.infer<typeof DaemonSyncArtifactsInputSchema>

export const syncDaemonArtifactsContract = contractBuilder
	.input(DaemonSyncArtifactsInputSchema)
	.output(createSyncOutputSchema(artifactSelectSchema))
