import { and, eq, not, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

/**
 * Represents a task draft for display in the Drafts tab
 */
export interface TaskDraft {
	id: string
	name: string
	slug: string | null
	default_working_directory: string | null
	ticket_id: string | null
	ticket_description: string | null
	ticket_provider: string | null
	created_at: bigint | null
	updated_at: bigint | null
}

/**
 * Get draft tasks (is_draft=true) for the current user
 * Ownership filter is intentional: not syncing other users' draft tasks
 */
export function useDraftTasks(userId?: string | null): TaskDraft[] {
	const { tasksCollection } = useSync()
	const { data: draftTasks } = useLiveQuery(
		(q) => {
			// Intentional: Drafts tab shows only owned task drafts (not syncing shared drafts)
			if (!userId) return undefined
			return q
				.from({ tasks: tasksCollection })
				.where(({ tasks }) =>
					and(
						eq(tasks.is_draft, true),
						not(eq(tasks.archived, true)),
						eq(tasks.resource_owner_user_id, userId),
					),
				)
				.select(({ tasks }) => ({
					id: tasks.id,
					name: tasks.name,
					slug: tasks.slug,
					default_working_directory: tasks.default_working_directory,
					ticket_id: tasks.ticket_id,
					ticket_description: tasks.ticket_description,
					ticket_provider: tasks.ticket_provider,
					created_at: tasks.created_at,
					updated_at: tasks.updated_at,
				}))
				.orderBy(({ tasks }) => tasks.updated_at, 'desc')
		},
		[tasksCollection, userId],
	)

	return draftTasks ?? []
}
