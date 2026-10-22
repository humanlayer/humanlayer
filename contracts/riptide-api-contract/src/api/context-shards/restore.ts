import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { UserContextShardStateSchema } from './list'

export const RestoreContextShardInputSchema = z.object({
	shardId: z.uuid().describe('The user-dismissed context shard to restore'),
})

export const RestoreContextShardOutputSchema = z.object({
	shardId: z.uuid(),
	shardState: UserContextShardStateSchema,
})

/**
 * Restore a user-dismissed shard back to the active list for the current user.
 * Upserts the preference to `disabled`, so the shard does not affect sessions
 * until the user enables it again.
 */
export const restoreContextShardContract = contractBuilder
	.input(RestoreContextShardInputSchema)
	.output(RestoreContextShardOutputSchema)
