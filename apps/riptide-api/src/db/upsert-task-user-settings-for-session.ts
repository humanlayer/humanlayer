import { taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

interface UpsertTaskUserSettingsForSessionParams {
	taskId: string
	userId: string
	organizationId: string
	workingDirectory: string
	hostId: string | null
	/**
	 * When true, an existing row's `working_directory` is overwritten with the new value.
	 * When false, an existing row keeps its prior `working_directory`; only `host_id` and
	 * `updated_at` are refreshed. New rows always get the supplied `working_directory`.
	 */
	updateExistingDirectory: boolean
}

export async function upsertTaskUserSettingsForSession(
	tx: PgDatabase<PostgresJsQueryResultHKT>,
	params: UpsertTaskUserSettingsForSessionParams,
): Promise<void> {
	const updates: Partial<typeof taskUserSettings.$inferInsert> = {
		host_id: params.hostId,
		updated_at: BigInt(Date.now()),
	}
	if (params.updateExistingDirectory) updates.working_directory = params.workingDirectory
	await tx
		.insert(taskUserSettings)
		.values({
			task_id: params.taskId,
			user_id: params.userId,
			organization_id: params.organizationId,
			working_directory: params.workingDirectory,
			host_id: params.hostId,
		})
		.onConflictDoUpdate({
			target: [taskUserSettings.organization_id, taskUserSettings.user_id, taskUserSettings.task_id],
			set: updates,
		})
}
