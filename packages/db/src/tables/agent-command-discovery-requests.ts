import { sql } from 'drizzle-orm'
import { bigint, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'
import { createSelectSchema } from 'drizzle-zod'

import { organizations } from './organizations'

// The directory most recently asked to be read on this host, so its project commands and skills
// are known before any session has run there. The daemon answers in agent_slash_commands.
export const agentCommandDiscoveryRequests = pgTable(
	'agent_command_discovery_requests',
	{
		organization_id: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		host_id: text('host_id').notNull(),
		user_id: text('user_id').notNull(),
		agent: text('agent').notNull().default('claude'),
		workspace_path: text('workspace_path').notNull(),
		requested_at: bigint('requested_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now()))
			.$onUpdateFn(() => BigInt(Date.now())),
	},
	(t) => [
		// Daemon sync filters by organization_id + host_id.
		primaryKey({
			name: 'agent_command_discovery_requests_pk',
			columns: [t.organization_id, t.host_id, t.user_id, t.agent],
		}),
	],
)

export const agentCommandDiscoveryRequestSelectSchema = createSelectSchema(agentCommandDiscoveryRequests)
export type AgentCommandDiscoveryRequest = typeof agentCommandDiscoveryRequests.$inferSelect
