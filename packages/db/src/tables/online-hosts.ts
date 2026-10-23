import { type CodingAgentUsageLimits, CodingAgentUsageLimitsSchema } from '@humanlayer/schemas/zod/host/usage-limits'
import { type HostModelCatalog, HostModelCatalogSchema } from '@humanlayer/schemas/zod/model-catalog'
import { sql } from 'drizzle-orm'
import { bigint, boolean, index, jsonb, pgEnum, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import type z from 'zod/v4'

import { jsonbParser } from '../utils/jsonb-parser'
import {
	type HostMachine,
	HostMachineSchema,
	type HostProcessGroup,
	type HostStats,
	HostStatsSchema,
} from '../zodschemas/host-machine-stats'
import { organizations } from './organizations'

export const onlineHostStatus = pgEnum('online_host_status', ['online', 'offline'])

export const onlineHostDistribution = pgEnum('online_host_distribution', ['cli', 'desktop'])

export const onlineHostUpdateState = pgEnum('online_host_update_state', ['requested', 'installing', 'failed'])

export const onlineHosts = pgTable(
	'online_hosts',
	{
		host_id: text().notNull(),
		user_id: text().notNull(),
		host_name: text(),
		status: onlineHostStatus().notNull().default('online'),
		/** Build version the daemon last heartbeated with; null for one built before it was sent. */
		daemon_version: text('daemon_version'),
		/** Read only by app builds that predate `capabilities`. Drop once those builds are gone. */
		reports_repositories: boolean('reports_repositories'),
		/**
		 * Capability names the daemon sent at the last heartbeat. Null for a daemon that predates the
		 * list; the app then falls back to the daemon's CLI version.
		 */
		capabilities: text('capabilities').array(),
		/**
		 * Models the host's runtimes offered at the last heartbeat, probed by the daemon. Null for
		 * a daemon that predates the probe or has not finished its first one.
		 */
		supported_models: jsonb('supported_models').$type<HostModelCatalog>(),
		/** How the daemon was installed; null for one built before it was sent. */
		distribution: onlineHostDistribution('distribution'),
		/** Whether the daemon can install a new version of itself and restart. */
		can_self_update: boolean('can_self_update'),
		/** Registration belongs to a bounded automation run; older daemons default to false. */
		ephemeral: boolean('ephemeral').notNull().default(false),
		update_requested_version: text('update_requested_version'),
		update_state: onlineHostUpdateState('update_state'),
		update_error: text('update_error'),
		/** Hardware and OS of the machine. Null for a daemon built before machine stats were sent. */
		machine: jsonb('machine').$type<HostMachine>(),
		/**
		 * Newest load sample, overwritten by every heartbeat. No history is kept: a consumer that
		 * wants a trend accumulates the samples it observes. Null for a daemon that cannot send it.
		 */
		stats: jsonb('stats').$type<HostStats>(),
		/**
		 * Subscription usage windows the daemon last observed for each coding agent on this host.
		 * Null until a daemon that reports them has seen a rate-limit signal.
		 */
		coding_agent_usage_limits: jsonb('coding_agent_usage_limits').$type<CodingAgentUsageLimits>(),
		last_seen: bigint('last_seen', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
	},
	(t) => [
		// Real PK (not just UNIQUE): Electric only allows shape column filtering
		// (e.g. the /v3/hosts shape excluding last_seen) on tables with a primary key.
		primaryKey({ name: 'online_hosts_pk', columns: [t.host_id, t.organization_id, t.user_id] }),
		index('online_hosts_org_user_idx').on(t.organization_id, t.user_id),
		index('online_hosts_status_last_seen_idx').on(t.status, t.last_seen),
		// Cross-organization cleanup scans only ephemeral registrations by heartbeat age.
		index('online_hosts_ephemeral_last_seen_idx')
			.on(t.last_seen)
			.where(sql`${t.ephemeral}`),
	],
)

export const onlineHostSelectSchema = createSelectSchema(onlineHosts, {
	supported_models: jsonbParser(HostModelCatalogSchema.nullish()),
	machine: jsonbParser(HostMachineSchema.nullable()),
	stats: jsonbParser(HostStatsSchema.nullable()),
	coding_agent_usage_limits: jsonbParser(CodingAgentUsageLimitsSchema.nullable()),
})
export const onlineHostInsertSchema = createInsertSchema(onlineHosts, {
	supported_models: HostModelCatalogSchema.nullable().optional(),
	machine: HostMachineSchema.nullish(),
	stats: HostStatsSchema.nullish(),
	coding_agent_usage_limits: CodingAgentUsageLimitsSchema.nullish(),
})
export const onlineHostUpdateSchema = createUpdateSchema(onlineHosts, {
	supported_models: HostModelCatalogSchema.nullable().optional(),
	machine: HostMachineSchema.nullish(),
	stats: HostStatsSchema.nullish(),
	coding_agent_usage_limits: CodingAgentUsageLimitsSchema.nullish(),
})
export type OnlineHost = typeof onlineHosts.$inferSelect
export type OnlineHostRow = z.infer<typeof onlineHostSelectSchema>
export type NewOnlineHost = typeof onlineHosts.$inferInsert
export { type HostMachine, HostMachineSchema, type HostProcessGroup, type HostStats, HostStatsSchema }
