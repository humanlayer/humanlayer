import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import z from 'zod/v4'

import { createSyncOutputSchema, SyncInputSchema } from '../../api/sync/shared-schemas'
import { contractBuilder } from '../../contract-builder'

/**
 * Input schema for the daemon sessions sync route.
 *
 * Extends SyncInputSchema with hostId (required). The handler enforces
 * an IDOR guard: input.hostId must match context.auth.hostId from the
 * daemon token, preventing a daemon from requesting another host's sessions.
 */
export const DaemonSyncSessionsInputSchema = SyncInputSchema.extend({
	hostId: z.string().uuid(),
})

export type DaemonSyncSessionsInput = z.infer<typeof DaemonSyncSessionsInputSchema>

export const syncDaemonSessionsContract = contractBuilder
	.input(DaemonSyncSessionsInputSchema)
	.output(createSyncOutputSchema(sessionSelectSchema))
