import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { tasks } from '@humanlayer/db/tables/tasks'
import { and, type SQL, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { QueryBuilder } from 'drizzle-orm/pg-core'

/**
 * A condition for the WHERE clause builder.
 * Uses the actual column reference for type safety.
 */
export type WhereCondition = {
	column: PgColumn
	value: string
}

/**
 * Builds a WHERE fragment from a list of conditions using Drizzle's QueryBuilder.
 * This ensures proper SQL escaping and parameterization.
 *
 * @param table - The Drizzle table to build the query against
 * @param conditions - Array of column/value conditions to AND together
 * @returns The SQL fragment (without "WHERE") and the parameter values
 */
export function buildWhereFragment(
	table: PgTable,
	conditions: WhereCondition[],
): { fragment: string; params: unknown[] } {
	const expressions: SQL[] = conditions.map(({ column, value }) => sql`${sql.identifier(column.name)} = ${value}`)

	const queryBuilder = new QueryBuilder()
	const { sql: query, params } = queryBuilder
		.select()
		.from(table)
		.where(and(...expressions))
		.toSQL()

	// Extract just the WHERE clause content (remove "SELECT ... FROM ... WHERE ")
	const fragment = query.replace(/^SELECT .* FROM .* WHERE\s+/i, '')

	return { fragment, params }
}

/**
 * Applies a WHERE fragment and its parameters to an Electric URL.
 *
 * @param url - The Electric origin URL to modify (mutated in place)
 * @param fragment - The SQL WHERE fragment
 * @param params - The parameter values (1-indexed in the URL)
 */
export function applyWhereToUrl(url: URL, fragment: string, params: unknown[]): void {
	url.searchParams.set('where', fragment)
	for (let i = 0; i < params.length; i++) {
		url.searchParams.set(`params[${i + 1}]`, String(params[i]))
	}
}

/**
 * Build WHERE fragment with ownership OR ACL subquery conditions.
 * Uses sql.identifier() for column/table names and parameterized values.
 */

export function buildWhereFragmentWithAcl(
	table: PgTable,
	auth: { organizationId: string; userId: string },
	options?: {
		taskIdColumn?: string
		additionalConditions?: WhereCondition[]
	},
): { fragment: string; params: unknown[] } {
	const taskIdCol = options?.taskIdColumn ?? 'task_id'

	const orgCondition = sql`${sql.identifier('organization_id')} = ${auth.organizationId}`

	const ownershipOrAcl = sql`(
		${sql.identifier('resource_owner_user_id')} = ${auth.userId}
		OR (${sql.identifier(taskIdCol)} IS NOT NULL AND ${sql.identifier(taskIdCol)} IN (
			SELECT ${sql.identifier('task_id')} FROM ${sql.identifier('task_user_acl')}
			WHERE ${sql.identifier('subject_user_id')} = ${auth.userId}
			AND ${sql.identifier('organization_id')} = ${auth.organizationId}
		))
		OR (${sql.identifier(taskIdCol)} IS NOT NULL AND ${sql.identifier(taskIdCol)} IN (
			SELECT ${sql.identifier('task_id')} FROM ${sql.identifier('task_organization_acl')}
			WHERE ${sql.identifier('organization_id')} = ${auth.organizationId}
		))
	)`

	const additionalExpressions = (options?.additionalConditions ?? []).map(
		({ column, value }) => sql`${sql.identifier(column.name)} = ${value}`,
	)

	const queryBuilder = new QueryBuilder()
	const { sql: query, params } = queryBuilder
		.select()
		.from(table)
		.where(and(orgCondition, ownershipOrAcl, ...additionalExpressions))
		.toSQL()

	const fragment = query.replace(/^SELECT .* FROM .* WHERE\s+/i, '')
	return { fragment, params }
}

/**
 * Special case for tasks table - ACL lookup uses tasks.id instead of task_id
 */
export function buildWhereFragmentForTasks(auth: { organizationId: string; userId: string }): {
	fragment: string
	params: unknown[]
} {
	const orgCondition = sql`${sql.identifier('organization_id')} = ${auth.organizationId}`

	const ownershipOrAcl = sql`(
		${sql.identifier('resource_owner_user_id')} = ${auth.userId}
		OR ${sql.identifier('id')} IN (
			SELECT ${sql.identifier('task_id')} FROM ${sql.identifier('task_user_acl')}
			WHERE ${sql.identifier('subject_user_id')} = ${auth.userId}
			AND ${sql.identifier('organization_id')} = ${auth.organizationId}
		)
		OR ${sql.identifier('id')} IN (
			SELECT ${sql.identifier('task_id')} FROM ${sql.identifier('task_organization_acl')}
			WHERE ${sql.identifier('organization_id')} = ${auth.organizationId}
		)
	)`

	const queryBuilder = new QueryBuilder()
	const { sql: query, params } = queryBuilder.select().from(tasks).where(and(orgCondition, ownershipOrAcl)).toSQL()

	const fragment = query.replace(/^SELECT .* FROM .* WHERE\s+/i, '')
	return { fragment, params }
}

/**
 * Build WHERE fragment for shared artifact access via share key.
 * No user/org/ACL context — the share key maps directly to the resource.
 */
export function buildWhereFragmentForSharedArtifact(
	artifactId: string,
	shareKey: string,
): { fragment: string; params: unknown[] } {
	const queryBuilder = new QueryBuilder()
	const { sql: query, params } = queryBuilder
		.select()
		.from(artifacts)
		.where(
			and(
				sql`${sql.identifier('id')} = ${artifactId}`,
				sql`${sql.identifier('share_key')} = ${shareKey}`,
				sql`${sql.identifier('share_enabled')} = true`,
			),
		)
		.toSQL()

	const fragment = query.replace(/^SELECT .* FROM .* WHERE\s+/i, '')
	return { fragment, params }
}

/** Build a capability-authorized shape predicate scoped to one artifact's comments. */
export function buildWhereFragmentForSharedArtifactComments(artifactId: string): {
	fragment: string
	params: unknown[]
} {
	return buildWhereFragment(artifactComments, [{ column: artifactComments.artifact_id, value: artifactId }])
}
