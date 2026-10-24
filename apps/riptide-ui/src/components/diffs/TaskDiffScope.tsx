import type { WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'
import { type ReactNode, useMemo, useState } from 'react'

import {
	createTaskDiffFilesDatabase,
	createTaskDiffVersionsDatabase,
	probeTaskDiffProtocol,
	type TaskDiffFilesStreamDB,
	type TaskDiffVersionsStreamDB,
} from '@/collections/stream/task-diffs'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { getMissingReviewVersionIds } from '@/hooks/diffs/useTaskDiffComparisons'
import { useTaskDiffReviewMarksStore } from '@/hooks/stores/taskDiffReviewMarksStore'
import { useTaskDiffReviewStore } from '@/hooks/stores/taskDiffReviewStore'
import { TaskDiffVisibilityStoreProvider } from '@/hooks/stores/taskDiffVisibilityStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { isNotFoundError } from '@/hooks/useStreamLiveness'
import { logger } from '@/lib/logger'

import { TaskDiffContext, type TaskDiffDatabaseStatus, type TaskDiffProtocolState } from './task-diff-context'

/** How often a scope without the new payload stream checks again, e.g. after a daemon update. */
export const TASK_DIFF_PROTOCOL_PROBE_INTERVAL_MS = 5_000
export const TASK_DIFF_FILES_RETRY_INTERVAL_MS = 5_000

type TaskDiffScopeProps = {
	taskId: string
	children: ReactNode
	loading: ReactNode
	missing: ReactNode
}

export function TaskDiffScope({ taskId, children, loading, missing }: TaskDiffScopeProps) {
	return (
		<TaskDiffScopeForTask key={taskId} taskId={taskId} loading={loading} missing={missing}>
			{children}
		</TaskDiffScopeForTask>
	)
}

function TaskDiffScopeForTask({ taskId, children, loading, missing }: TaskDiffScopeProps) {
	const { tasksCollection } = useSync()
	const { syncAuthReady } = useSyncInternal()
	const { isLoading: isAuthLoading } = useAuth()
	const {
		data: tasks,
		isReady: isTaskQueryReady,
		isLoading: isTaskLoading,
	} = useLiveQuery(
		(q) => q.from({ tasks: tasksCollection }).where(({ tasks }) => eq(tasks.id, taskId)),
		[tasksCollection, taskId],
	)
	const organizationId = tasks?.[0]?.organization_id
	const workspaceId = tasks?.[0]?.workspace_id ?? null
	const workspaceState = tasks?.[0]?.workspace_state ?? null
	const isTaskSettled = isTaskQueryReady && !isTaskLoading && syncAuthReady

	if (isAuthLoading || (!organizationId && !isTaskSettled)) return loading
	if (!organizationId) return missing
	return (
		<TaskDiffDatabaseScope
			key={`${organizationId}:${taskId}`}
			taskId={taskId}
			organizationId={organizationId}
			workspaceId={workspaceId}
			workspaceState={workspaceState}
		>
			{children}
		</TaskDiffDatabaseScope>
	)
}

/**
 * Once the versions stream has replayed, a reviewed version it lacks will never arrive (the
 * stream was rebuilt). Forget it so the file compares from task start again.
 */
function dropMissingReviewMarks(taskId: string, database: TaskDiffVersionsStreamDB): void {
	const marks = useTaskDiffReviewMarksStore.getState()
	const missing = getMissingReviewVersionIds(
		[marks.reviewedByTask[taskId] ?? {}, marks.unmarkedByTask[taskId] ?? {}],
		database.collections.versions,
	)
	if (missing.length > 0) marks.dropReviewVersions(taskId, missing)
}

export function TaskDiffDatabaseScope({
	taskId,
	organizationId,
	workspaceId = null,
	workspaceState = null,
	children,
}: {
	taskId: string
	organizationId: string
	workspaceId?: string | null
	workspaceState?: WorkspaceState | null
	children: ReactNode
}) {
	const { getAccessToken } = useAuth()
	const [location] = useState(() => ({ taskId, organizationId, getAccessToken }))
	const [filesDatabase, setFilesDatabase] = useState<TaskDiffFilesStreamDB | null>(null)
	const [versionsDatabase, setVersionsDatabase] = useState<TaskDiffVersionsStreamDB | null>(null)
	const databases = useMemo(
		() => ({ files: filesDatabase, versions: versionsDatabase }),
		[filesDatabase, versionsDatabase],
	)
	const [filesStatus, setFilesStatus] = useState<TaskDiffDatabaseStatus>('loading')
	const [filesError, setFilesError] = useState<Error | null>(null)
	const [protocol, setProtocol] = useState<TaskDiffProtocolState>('probing')
	const [versionsStatus, setVersionsStatus] = useState<TaskDiffDatabaseStatus>('loading')
	const [versionsError, setVersionsError] = useState<Error | null>(null)

	useMountEffect(() => {
		let active = true
		let openedFiles: TaskDiffFilesStreamDB | null = null
		let openedVersions: TaskDiffVersionsStreamDB | null = null
		let filesTimer: ReturnType<typeof setTimeout> | undefined
		let probeTimer: ReturnType<typeof setTimeout> | undefined
		logger.info('[task-diffs] preloading route resources', { organizationId, taskId })

		const openFiles = () => {
			const database = createTaskDiffFilesDatabase(location)
			openedFiles = database
			setFilesDatabase(database)
			void database.preload().then(
				() => {
					if (!active) return
					setFilesError(null)
					setFilesStatus('ready')
				},
				(error: unknown) => {
					if (!active) return
					database.close()
					showFilesFailure(error)
					filesTimer = setTimeout(openFiles, TASK_DIFF_FILES_RETRY_INTERVAL_MS)
				},
			)
		}
		const showFilesFailure = (error: unknown) => {
			const filesStreamNotCreatedYet = isNotFoundError(error)
			if (filesStreamNotCreatedYet) {
				setFilesError(null)
				setFilesStatus('loading')
				return
			}
			setFilesError(error instanceof Error ? error : new Error('Unable to load task diff files'))
			setFilesStatus('unavailable')
		}
		openFiles()

		const openVersions = () => {
			const database = createTaskDiffVersionsDatabase(location)
			openedVersions = database
			setVersionsDatabase(database)
			void database.preload().then(
				() => {
					if (!active) return
					dropMissingReviewMarks(taskId, database)
					setVersionsError(null)
					setVersionsStatus('ready')
				},
				(error: unknown) => {
					if (!active) return
					setVersionsError(
						error instanceof Error ? error : new Error('Unable to load task diff file versions'),
					)
					setVersionsStatus('unavailable')
				},
			)
		}
		// Until the new stream exists, keep checking: the first capture creates it, and an
		// updated daemon creates it next to an old `diff-patches` stream.
		const probe = () => {
			void probeTaskDiffProtocol(location).then(
				(nextProtocol) => {
					if (!active) return
					setProtocol(nextProtocol)
					if (nextProtocol === 'versions') {
						setVersionsError(null)
						setVersionsStatus('loading')
						openVersions()
						return
					}
					setVersionsError(null)
					setVersionsStatus(nextProtocol === 'none' ? 'loading' : 'unavailable')
					probeTimer = setTimeout(probe, TASK_DIFF_PROTOCOL_PROBE_INTERVAL_MS)
				},
				(error: unknown) => {
					if (!active) return
					setVersionsError(error instanceof Error ? error : new Error('Unable to check task diff streams'))
					setVersionsStatus('unavailable')
					probeTimer = setTimeout(probe, TASK_DIFF_PROTOCOL_PROBE_INTERVAL_MS)
				},
			)
		}
		probe()

		return () => {
			active = false
			if (filesTimer !== undefined) clearTimeout(filesTimer)
			if (probeTimer !== undefined) clearTimeout(probeTimer)
			const presentation = useTaskDiffReviewStore.getState().presentationByTask[taskId]
			if (presentation?.active === 'fullscreen') {
				useTaskDiffReviewStore.getState().setPresentation(taskId, {
					active: presentation.fullscreenOrigin,
					fullscreenOrigin: null,
				})
			}
			openedFiles?.close()
			openedVersions?.close()
		}
	})

	return (
		<TaskDiffContext.Provider
			value={{
				taskId,
				organizationId,
				workspaceId,
				workspaceState,
				databases,
				filesStatus,
				filesError,
				protocol,
				versionsStatus,
				versionsError,
			}}
		>
			<TaskDiffVisibilityStoreProvider taskId={taskId}>{children}</TaskDiffVisibilityStoreProvider>
		</TaskDiffContext.Provider>
	)
}
