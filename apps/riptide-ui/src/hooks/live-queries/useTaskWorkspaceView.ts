import { deriveWorkspaceView, type WorkspaceView } from '@humanlayer/db/utils/workspace-view'
import type { WorkspaceSpec, WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import { and, eq, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

interface WorkspaceTaskInput {
	readonly id: string
	readonly workspace_spec: WorkspaceSpec | null
	readonly workspace_state: WorkspaceState | null
}

/** Resolve a task workspace from its spec and the selected host's setup row. */
export function useTaskWorkspaceView(
	task: WorkspaceTaskInput | null | undefined,
	hostId: string | null | undefined,
): WorkspaceView | null {
	const { taskWorkspaceSetupForHostCollection } = useSync()
	const { data } = useLiveQuery(
		(q) => {
			if (!task?.id || !hostId) return undefined
			return q
				.from({ setup: taskWorkspaceSetupForHostCollection })
				.where(({ setup }) => and(eq(setup.task_id, task.id), eq(setup.host_id, hostId)))
		},
		[taskWorkspaceSetupForHostCollection, task?.id, hostId],
	)

	return deriveWorkspaceView({
		workspaceSpec: task ? task.workspace_spec : null,
		workspaceSetupState: data?.[0]?.workspace_setup_state,
		legacyWorkspaceState: task ? task.workspace_state : null,
	})
}
