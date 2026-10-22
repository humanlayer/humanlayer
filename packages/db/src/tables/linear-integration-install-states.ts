import { sql } from 'drizzle-orm'
import { bigint, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { organizations } from './organizations'

export const linearIntegrationInstallStates = pgTable(
	'linear_integration_install_states',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		state_token_hash: text('state_token_hash').notNull().unique(),
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		requested_by_user_id: text('requested_by_user_id').notNull(),
		/** Which client started the flow ('ui' | 'cloud' | 'native'); decides the result screen's primary button. */
		return_client: text('return_client').notNull(),
		expires_at: bigint('expires_at', { mode: 'bigint' }).notNull(),
		consumed_at: bigint('consumed_at', { mode: 'bigint' }),
		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
	},
	(table) => [index('linear_install_states_organization_id_index').on(table.organization_id)],
)

export const linearIntegrationInstallStateSelectSchema = createSelectSchema(linearIntegrationInstallStates)
export const linearIntegrationInstallStateInsertSchema = createInsertSchema(linearIntegrationInstallStates)
export const linearIntegrationInstallStateUpdateSchema = createUpdateSchema(linearIntegrationInstallStates)
export type LinearIntegrationInstallState = typeof linearIntegrationInstallStates.$inferSelect
