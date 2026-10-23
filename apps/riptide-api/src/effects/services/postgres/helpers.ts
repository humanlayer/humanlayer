import { tasks } from '@humanlayer/db/tables/tasks'
import { and, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { checkTaskReadPermission, getTaskWithEffectivePermissions } from '../../../db/task-auth'
import type { PostgresTransaction } from './postgres-db.service'
import { TaskNotFoundError, TaskPermissionDeniedError } from './task.errors'

/**
 * Returns the current PostgreSQL transaction ID.
 * Useful for optimistic concurrency control on the client.
 */
export function getTransactionId(tx: PostgresTransaction) {
	return tx
		.query(tx.client.execute<{ txid: string }>(sql`SELECT pg_current_xact_id()::text as txid`))
		.pipe(Effect.map(([row]) => row?.txid ?? ''))
}

/**
 * Verifies the user has at least read permission on the task.
 * @returns The task if access is granted
 * @fails TaskNotFoundError if task doesn't exist or user has no access
 */
export function requireTaskReadPermission(
	tx: PostgresTransaction,
	params: { taskId: string; userId: string; organizationId: string },
) {
	return Effect.gen(function* () {
		const result = yield* tx.run(() =>
			checkTaskReadPermission(tx.client, params.taskId, params.userId, params.organizationId),
		)
		if (!result.ok) {
			return yield* Effect.fail(
				new TaskNotFoundError({ taskId: params.taskId, organizationId: params.organizationId }),
			)
		}
		return result.task
	})
}

/** Locks the task before checking access for an owner-derived write. */
export function requireTaskReadPermissionForUpdate(
	tx: PostgresTransaction,
	params: { taskId: string; userId: string; organizationId: string },
) {
	return Effect.gen(function* () {
		yield* tx.query(
			tx.client
				.select({ id: tasks.id })
				.from(tasks)
				.where(and(eq(tasks.id, params.taskId), eq(tasks.organization_id, params.organizationId)))
				.limit(1)
				.for('no key update'),
		)
		return yield* requireTaskReadPermission(tx, params)
	})
}

/**
 * Verifies the user has edit permission on the task.
 * @returns The task with effective permissions if access is granted
 * @fails TaskNotFoundError if task doesn't exist
 * @fails TaskPermissionDeniedError if user lacks edit permission
 */
export function requireTaskEditPermission(
	tx: PostgresTransaction,
	params: { taskId: string; userId: string; organizationId: string },
) {
	return Effect.gen(function* () {
		const task = yield* tx.run(() =>
			getTaskWithEffectivePermissions(tx.client, params.taskId, params.userId, params.organizationId, {
				lockForUpdate: true,
			}),
		)
		if (!task) {
			return yield* Effect.fail(
				new TaskNotFoundError({ taskId: params.taskId, organizationId: params.organizationId }),
			)
		}
		if (task.effectivePermission !== 'edit') {
			return yield* Effect.fail(
				new TaskPermissionDeniedError({
					taskId: params.taskId,
					userId: params.userId,
					organizationId: params.organizationId,
					required: 'edit',
					actual: task.effectivePermission,
				}),
			)
		}
		return task
	})
}
