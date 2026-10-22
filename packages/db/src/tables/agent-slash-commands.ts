import { sql } from 'drizzle-orm'
import { bigint, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'
import { createSelectSchema } from 'drizzle-zod'
import z from 'zod/v4'

import { jsonbParser } from '../utils/jsonb-parser'
import { organizations } from './organizations'

// Electric requires a non-null primary key, so the host-level row uses '' rather
// than NULL; a real path is never empty.
export const HOST_LEVEL_WORKSPACE_PATH = ''

export const AgentCommandScopeSchema = z.enum(['user', 'project', 'plugin'])
export type AgentCommandScope = z.infer<typeof AgentCommandScopeSchema>

export const AgentCommandSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	argumentHint: z.string().optional(),
	scope: AgentCommandScopeSchema.optional(),
})
export type AgentCommand = z.infer<typeof AgentCommandSchema>

export const AgentSkillSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	scope: AgentCommandScopeSchema.optional(),
})
export type AgentSkill = z.infer<typeof AgentSkillSchema>

export const AgentCommandsSchema = z.array(AgentCommandSchema)
export const AgentSkillsSchema = z.array(AgentSkillSchema)

export const agentSlashCommands = pgTable(
	'agent_slash_commands',
	{
		organization_id: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		user_id: text('user_id').notNull(),
		host_id: text('host_id').notNull(),
		agent: text('agent').notNull().default('claude'),
		workspace_path: text('workspace_path').notNull(),
		commands: jsonb('commands').$type<AgentCommand[]>().notNull(),
		skills: jsonb('skills').$type<AgentSkill[]>().notNull(),
		updated_at: bigint('updated_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now()))
			.$onUpdateFn(() => BigInt(Date.now())),
	},
	(t) => [
		primaryKey({
			name: 'agent_slash_commands_pk',
			columns: [t.organization_id, t.user_id, t.host_id, t.agent, t.workspace_path],
		}),
	],
)

export const agentSlashCommandsSelectSchema = createSelectSchema(agentSlashCommands, {
	commands: jsonbParser(AgentCommandsSchema),
	skills: jsonbParser(AgentSkillsSchema),
})
export type AgentSlashCommands = typeof agentSlashCommands.$inferSelect
export type NewAgentSlashCommands = typeof agentSlashCommands.$inferInsert
