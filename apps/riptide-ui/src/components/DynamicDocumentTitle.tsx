import { eq, useLiveQuery } from '@tanstack/react-db'
import { useLocation, useParams } from '@tanstack/react-router'

import { useSync } from '@/components/providers/SyncProvider'
import { useArtifactContent } from '@/hooks/live-queries/useArtifactContent'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'

import { formatDocumentTitle, PRODUCT_NAME } from './documentTitle'

export function DynamicDocumentTitle() {
	const location = useLocation()
	const params = useParams({ strict: false })
	const sessionId = params.sessionId as string | undefined
	const taskId = params.taskId as string | undefined
	const isSessionDetail = location.pathname.startsWith('/sessions/') && !!sessionId
	const isTaskDetail = location.pathname.startsWith('/tasks/') && !!taskId
	const { sessionsCollection, tasksCollection } = useSync()

	const { data: sessionData } = useLiveQuery(
		(q) =>
			isSessionDetail
				? q.from({ sessions: sessionsCollection }).where(({ sessions }) => eq(sessions.id, sessionId))
				: undefined,
		[sessionsCollection, isSessionDetail, sessionId],
	)
	const { data: taskData } = useLiveQuery(
		(q) =>
			isTaskDetail ? q.from({ tasks: tasksCollection }).where(({ tasks }) => eq(tasks.id, taskId)) : undefined,
		[tasksCollection, isTaskDetail, taskId],
	)

	const selectedArtifactId = useArtifactViewerStore((state) => state.selectedArtifactId)
	const isFullscreen = useArtifactViewerStore((state) => state.isFullscreen)
	const isFullscreenModalOpen = useArtifactViewerStore((state) => state.isFullscreenModalOpen)
	const { artifact: selectedArtifact } = useArtifactContent(selectedArtifactId)

	const session = sessionData?.[0]
	const resourceName = isTaskDetail
		? taskData?.[0]?.name
		: isSessionDetail
			? session?.title || `Session ${sessionId.slice(0, 8)}`
			: null
	const isArtifactFullscreen =
		(isTaskDetail || isSessionDetail) && !!selectedArtifactId && (isFullscreen || isFullscreenModalOpen)
	const defaultTitle = import.meta.env.VITE_PUBLIC_DEVSTACK_ID || PRODUCT_NAME

	return (
		<title>
			{formatDocumentTitle({
				resourceName,
				artifactFilename: selectedArtifact?.file_name,
				isArtifactFullscreen,
				defaultTitle,
			})}
		</title>
	)
}
