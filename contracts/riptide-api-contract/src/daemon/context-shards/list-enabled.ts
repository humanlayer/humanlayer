import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const EnabledContextShardSchema = z.object({
	id: z.uuid(),
	shardText: z.string(),
})
export type EnabledContextShard = z.infer<typeof EnabledContextShardSchema>

export const ListEnabledContextShardsInputSchema = z.object({}).optional()

export const ListEnabledContextShardsOutputSchema = z.object({
	data: z.array(EnabledContextShardSchema),
})

/**
 * List the context shards the authenticated daemon user has enabled.
 *
 * Identity comes from the daemon token: the query returns only shards in the
 * daemon's organization with a preference row for the daemon's user whose
 * state is `enabled`, and repeats the release/admin-dismissal guards. Rows are
 * ordered by shard id ascending and capped at 100.
 */
export const listEnabledContextShardsContract = contractBuilder
	.input(ListEnabledContextShardsInputSchema)
	.output(ListEnabledContextShardsOutputSchema)
