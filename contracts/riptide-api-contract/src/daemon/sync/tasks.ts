import { taskSelectSchema } from '@humanlayer/db/tables/tasks'

import { createSyncOutputSchema, SyncInputSchema } from '../../api/sync/shared-schemas'
import { contractBuilder } from '../../contract-builder'

/**
 * Input schema for the daemon tasks sync route.
 *
 * Uses SyncInputSchema directly (no additional fields).
 * The handler derives auth context from the daemon token — same ACL
 * as the UI-facing tasks route (organization_id + resource_owner_user_id
 * or task ACL subquery on tasks.id), without host_id scoping.
 * Tasks are not host-scoped — a daemon can see all tasks accessible
 * to the user/org it's authenticated as.
 */
export const syncDaemonTasksContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(taskSelectSchema))
