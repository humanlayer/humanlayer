import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { UserContextShardStateSchema } from './list'

export const UpdateContextShardPreferenceInputSchema = z.object({
	shardId: z.uuid().describe('The context shard to set a personal state for'),
	shardState: UserContextShardStateSchema.describe('The new personal state for the current user'),
})

export const UpdateContextShardPreferenceOutputSchema = z.object({
	shardId: z.uuid(),
	shardState: UserContextShardStateSchema,
})

/**
 * Upsert the authenticated user's sparse preference row for one released,
 * non-admin-dismissed organization shard. Never touches shared shard content
 * or another user's preference.
 */
export const updateContextShardPreferenceContract = contractBuilder
	.input(UpdateContextShardPreferenceInputSchema)
	.output(UpdateContextShardPreferenceOutputSchema)
