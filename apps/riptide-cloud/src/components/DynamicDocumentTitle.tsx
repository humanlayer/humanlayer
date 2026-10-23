import { eq, useLiveQuery } from '@tanstack/react-db'
import { useLocation, useParams } from '@tanstack/react-router'

import { useSync } from '@/providers/SyncProvider'

import { formatDocumentTitle } from './documentTitle'

export function DynamicDocumentTitle() {
	const location = useLocation()
	const params = useParams({ strict: false })
	const taskId = params.taskId as string | undefined
	const artifactId = params.artifactId as string | undefined
	const isTaskDetail = location.pathname.startsWith('/tasks/') && !!taskId
	const isArtifactDetail = location.pathname.startsWith('/artifacts/') && !!artifactId
	const { artifactsCollection, tasksCollection } = useSync()

	const { data: taskData } = useLiveQuery(
		(q) =>
			isTaskDetail
				? q
						.from({ tasks: tasksCollection })
						.where(({ tasks }) => eq(tasks.id, taskId))
						.select(({ tasks }) => ({ name: tasks.name }))
				: undefined,
		[tasksCollection, isTaskDetail, taskId],
	)
	const { data: artifactData } = useLiveQuery(
		(q) =>
			isArtifactDetail
				? q
						.from({ artifacts: artifactsCollection })
						.where(({ artifacts }) => eq(artifacts.id, artifactId))
						.select(({ artifacts }) => ({ fileName: artifacts.file_name }))
				: undefined,
		[artifactsCollection, isArtifactDetail, artifactId],
	)

	const resourceName = isArtifactDetail ? artifactData?.[0]?.fileName : isTaskDetail ? taskData?.[0]?.name : null
	const defaultTitle = import.meta.env.VITE_PUBLIC_DEVSTACK_ID || 'HumanLayer Cloud'

	return <title>{formatDocumentTitle(resourceName, defaultTitle)}</title>
}
