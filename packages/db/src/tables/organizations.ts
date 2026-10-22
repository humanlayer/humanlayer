import { sql } from 'drizzle-orm'
import { bigint, boolean, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'
import z from 'zod/v4'

export const organizations = pgTable(
	'organizations',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
		/**
		 * Track the time the session was last updated
		 */
		updated_at: bigint('updated_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now()))
			.$onUpdateFn(() => BigInt(Date.now())),
		name: text().notNull(),
		workos_organization_id: text().notNull(),
		stripe_customer_id: text('stripe_customer_id'),
		/**
		 * Set to true after creating a trial subscription. Prevents duplicate trials on re-subscription.
		 */
		has_received_trial: boolean('has_received_trial').notNull().default(false),
		eula_accepted_by: text('eula_accepted_by'),
		eula_accepted_at: bigint('eula_accepted_at', { mode: 'number' }),
	},
	(t) => [
		index('organizations_workos_organization_id_index').on(t.workos_organization_id),
		index('organizations_stripe_customer_id_index').on(t.stripe_customer_id),
	],
)

export const stripeCustomerIdSchema = z.string().trim().regex(/^cus_/, 'Stripe customer ID must start with cus_')

export const organizationSelectSchema = createSelectSchema(organizations, {
	stripe_customer_id: stripeCustomerIdSchema.nullable(),
})
export const organizationInsertSchema = createInsertSchema(organizations, {
	stripe_customer_id: stripeCustomerIdSchema.nullish(),
})
export const organizationUpdateSchema = createUpdateSchema(organizations, {
	stripe_customer_id: stripeCustomerIdSchema.nullish(),
})
export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
