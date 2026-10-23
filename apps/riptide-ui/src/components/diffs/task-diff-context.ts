import type { WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import { createContext, use } from 'react'

import type { TaskDiffDatabases, TaskDiffProtocol } from '@/collections/stream/task-diffs'

export type TaskDiffDatabaseStatus = 'loading' | 'ready' | 'unavailable'

/** `probing` until the first stream check answers. */
export type TaskDiffProtocolState = TaskDiffProtocol | 'probing'

export interface TaskDiffResource {
	taskId: string
	organizationId: string
	workspaceId: string | null
	workspaceState: WorkspaceState | null
	databases: TaskDiffDatabases
	filesStatus: TaskDiffDatabaseStatus
	filesError: Error | null
	protocol: TaskDiffProtocolState
	versionsStatus: TaskDiffDatabaseStatus
	versionsError: Error | null
}

export const TaskDiffContext = createContext<TaskDiffResource | null>(null)

export function useTaskDiffDatabases(): TaskDiffResource {
	const resource = use(TaskDiffContext)
	if (resource === null) throw new Error('useTaskDiffDatabases must be used within TaskDiffScope')
	return resource
}
