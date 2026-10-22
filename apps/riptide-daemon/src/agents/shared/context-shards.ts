import type { Session } from '@humanlayer/db/tables/sessions'

import logger from '@/logger'

import type { ORPCClient } from '../claudecode/types'

export type EnabledContextShard = {
	id: string
	shardText: string
}

/**
 * Render enabled context shards as the single stable system-prompt block both
 * agent paths inject on fresh launch. Returns null for an empty list so
 * callers append nothing rather than an empty XML element.
 */
export function renderContextShardsPromptBlock(shards: EnabledContextShard[]): string | null {
	if (shards.length === 0) return null
	const lines = shards.map((shard) => `- ${shard.shardText}`).join('\n')
	return `<additional_context_and_instructions>\n${lines}\n</additional_context_and_instructions>`
}

/**
 * Fetch the daemon user's enabled context shards for a fresh agent launch and
 * return the rendered prompt block.
 *
 * Callers must only invoke this when there is no resume ID; session
 * continuation never queries or injects shards. After a successful query this
 * emits one privacy-safe structured log with IDs and a count only — never
 * shard text, reasoning, or evidence. A failed query is non-fatal: the launch
 * proceeds without shards.
 */
export async function loadContextShardsPromptBlock(params: {
	orpc: Pick<ORPCClient, 'contextShards'>
	session: Pick<Session, 'id' | 'organization_id' | 'resource_owner_user_id'>
}): Promise<string | null> {
	const { orpc, session } = params

	try {
		const { data } = await orpc.contextShards.listEnabled({})
		logger.info(
			{
				organizationId: session.organization_id,
				userId: session.resource_owner_user_id,
				sessionId: session.id,
				shardIds: data.map((shard) => shard.id),
				shardCount: data.length,
			},
			'session.context_shards',
		)
		return renderContextShardsPromptBlock(data)
	} catch (error) {
		logger.warn({ sessionId: session.id, error }, 'Failed to fetch enabled context shards, launching without them')
		return null
	}
}
