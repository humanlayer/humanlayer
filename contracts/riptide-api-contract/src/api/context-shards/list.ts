import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const UserContextShardStateSchema = z.enum(['enabled', 'disabled', 'dismissed'])
export type UserContextShardState = z.infer<typeof UserContextShardStateSchema>

export const UserContextShardEvidenceSchema = z.object({
	citation: z.string(),
	conversationEventId: z.uuid().nullable(),
	sessionId: z.uuid(),
	taskId: z.uuid().nullable(),
	sourceUserId: z.string(),
	role: z.enum(['user', 'assistant']),
})
export type UserContextShardEvidence = z.infer<typeof UserContextShardEvidenceSchema>

export const UserContextShardRowSchema = z.object({
	id: z.uuid(),
	shardText: z.string(),
	evidence: z.array(UserContextShardEvidenceSchema),
	state: UserContextShardStateSchema,
	createdAt: z.number(),
})
export type UserContextShardRow = z.infer<typeof UserContextShardRowSchema>

export const ListContextShardsInputSchema = z.object({})

export const ListContextShardsOutputSchema = z.object({
	data: z.array(UserContextShardRowSchema),
})

/**
 * List the released, non-admin-dismissed context shards for the authenticated
 * user's organization, joined with that user's sparse preference.
 *
 * A shard with no preference row has effective state `disabled`. Active rows
 * come first by created_at DESC then id DESC; user-dismissed rows always sort
 * last in the same order.
 */
export const listContextShardsContract = contractBuilder
	.input(ListContextShardsInputSchema)
	.output(ListContextShardsOutputSchema)
