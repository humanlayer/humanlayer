import { agentSlashCommands } from '@humanlayer/db/tables/agent-slash-commands'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { tasks } from '@humanlayer/db/tables/tasks'
import { and, type SQL, sql } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { QueryBuilder } from 'drizzle-orm/pg-core'

import type { WhereCondition } from './where-builder'

function buildWhereFragment(
	table: PgTable,
	conditions: Array<WhereCondition | SQL>,
): { fragment: string; params: unknown[] } {
	const expressions: SQL[] = conditions.map((condition) => {
		if ('column' in condition) {
			return sql`${sql.identifier(condition.column.name)} = ${condition.value}`
		}
		return condition
	})

	const queryBuilder = new QueryBuilder()
	const { sql: query, params } = queryBuilder
		.select()
		.from(table)
		.where(and(...expressions))
		.toSQL()

	const fragment = query.replace(/^SELECT .* FROM .* WHERE\s+/i, '')
	return { fragment, params }
}

function organizationCondition(organizationId: string): SQL {
	return sql`${sql.identifier('organization_id')} = ${organizationId}`
}

export function buildWhereFragmentForOrgScopedRows(
	table: PgTable,
	auth: { organizationId: string },
	options?: { additionalConditions?: WhereCondition[] },
): { fragment: string; params: unknown[] } {
	const additionalConditions = options?.additionalConditions ?? []
	return buildWhereFragment(table, [organizationCondition(auth.organizationId), ...additionalConditions])
}

export function buildWhereFragmentForOrgScopedTasks(auth: { organizationId: string }) {
	return buildWhereFragment(tasks, [organizationCondition(auth.organizationId)])
}

export function buildWhereFragmentForOrgScopedTaskArtifacts(auth: { organizationId: string }, taskId: string) {
	return buildWhereFragment(artifacts, [
		organizationCondition(auth.organizationId),
		{ column: artifacts.task_id, value: taskId },
	])
}

function buildColumnsExcluding(table: PgTable, tableLabel: string, excluded: string[]): string {
	const queryBuilder = new QueryBuilder()
	const { sql: query } = queryBuilder.select().from(table).toSQL()
	const match = query.match(/^SELECT\s+(.+)\s+FROM\s+/i)
	if (!match?.[1]) {
		throw new Error(`Unable to derive ${tableLabel} columns`)
	}
	return match[1]
		.split(',')
		.map((column) => column.trim())
		.filter((column) => !excluded.includes(column))
		.join(',')
}

export function buildArtifactMetadataColumns(): string {
	return buildColumnsExcluding(artifacts, 'artifact metadata', ['"content"'])
}

export function buildOnlineHostsColumns(): string {
	return buildColumnsExcluding(onlineHosts, 'online hosts', [])
}

export function buildAgentSlashCommandsColumns(): string {
	return buildColumnsExcluding(agentSlashCommands, 'host agent commands', [])
}
