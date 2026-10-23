import { eq, useLiveQuery } from '@tanstack/react-db'

import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useTaskDiffReviewMarksStore } from '@/hooks/stores/taskDiffReviewMarksStore'
import { useMountEffect } from '@/hooks/useMountEffect'

/**
 * Drops saved diff review marks for tasks archived from another device or the CLI. Archive
 * actions in this app clear their own task; this catches the rest once the synced task list
 * loads. Renders nothing.
 */
export function TaskDiffReviewMarksPruner() {
	const { tasksCollection } = useSync()
	const { syncAuthReady } = useSyncInternal()
	const { data: archivedTasks, isReady } = useLiveQuery(
		(q) =>
			q
				.from({ tasks: tasksCollection })
				.where(({ tasks }) => eq(tasks.archived, true))
				.select(({ tasks }) => ({ id: tasks.id })),
		[tasksCollection],
	)
	// Electric reports a shape ready on any error, so readiness means nothing until sync can
	// authenticate. Pruning only archived tasks keeps an empty or failed list harmless.
	if (!syncAuthReady || !isReady) return null
	return <PruneArchivedTaskMarks archivedTaskIds={archivedTasks.map((task) => task.id)} />
}

function PruneArchivedTaskMarks({ archivedTaskIds }: { archivedTaskIds: readonly string[] }) {
	useMountEffect(() => {
		useTaskDiffReviewMarksStore.getState().pruneTasks(new Set(archivedTaskIds))
	})
	return null
}
