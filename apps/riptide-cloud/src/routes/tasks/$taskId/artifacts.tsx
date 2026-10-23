import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Button } from '@humanlayer/ui/components/button'
import { Card } from '@humanlayer/ui/components/card'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { FileQuestion } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { ArtifactTable, type TableArtifact } from '@/components/artifact-table'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { OrganizationSwitcher } from '@/components/OrganizationSwitcher'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useArtifactTableHotkeys } from '@/hooks/useArtifactTableHotkeys'
import { useSync } from '@/providers/SyncProvider'

import { countArtifactComments } from './comment-counts'

export const Route = createFileRoute('/tasks/$taskId/artifacts')({
	component: TaskArtifactsPage,
})

function TaskArtifactsPage() {
	const { taskId } = Route.useParams()
	const { artifactsCollection, artifactsMetadataCollection, tasksCollection, artifactCommentsCollection } = useSync()
	const navigate = useNavigate()

	// Preload full artifact content for this task so navigation to detail view is instant
	useLiveQuery(
		(q) => q.from({ artifacts: artifactsCollection }).where(({ artifacts }) => eq(artifacts.task_id, taskId)),
		[artifactsCollection, taskId],
	)

	const { focusedArtifactId, setFocusedArtifactId, focusSource } = useFocusStore()

	const shouldIgnoreMouseEvent = useCallback(() => {
		return focusSource !== 'mouse'
	}, [focusSource])

	// Fetch task name
	const { data: taskData, isReady: isTaskReady } = useLiveQuery(
		(q) =>
			q
				.from({ tasks: tasksCollection })
				.where(({ tasks }) => eq(tasks.id, taskId))
				.select(({ tasks }) => ({ name: tasks.name })),
		[tasksCollection, taskId],
	)
	const task = taskData?.[0]

	// Fetch task artifacts
	const {
		data: artifacts,
		isLoading,
		isError,
	} = useLiveQuery(
		(q) =>
			q
				.from({ artifacts: artifactsMetadataCollection })
				.leftJoin({ tasks: tasksCollection }, ({ artifacts, tasks }) => eq(artifacts.task_id, tasks.id))
				.where(({ artifacts }) => eq(artifacts.task_id, taskId))
				.select(({ artifacts, tasks }) => ({
					id: artifacts.id,
					file_name: artifacts.file_name,
					task_id: artifacts.task_id,
					task_slug: artifacts.task_slug,
					task_name: tasks?.name,
					last_updated_at: artifacts.last_updated_at,
					frontmatter: artifacts.frontmatter,
					is_deleted: artifacts.is_deleted,
				}))
				.orderBy(({ artifacts }) => artifacts.last_updated_at, 'desc'),
		[artifactsMetadataCollection, tasksCollection, taskId],
	)

	// Fetch comments for this task to count per artifact
	const { data: comments } = useLiveQuery(
		(q) =>
			q
				.from({ comments: artifactCommentsCollection })
				.where(({ comments }) => eq(comments.task_id, taskId))
				.select(({ comments }) => ({
					artifact_id: comments.artifact_id,
					is_deleted: comments.is_deleted,
				})),
		[artifactCommentsCollection, taskId],
	)

	// Build artifact list with comment counts
	const artifactList = useMemo(() => {
		if (!artifacts) return []

		const commentCounts = countArtifactComments(comments ?? [])

		return artifacts.map((artifact) => ({
			...artifact,
			comment_count: commentCounts.get(artifact.id) ?? 0,
		}))
	}, [artifacts, comments])

	// Navigation handlers
	const handleFocusNext = useCallback(() => {
		if (artifactList.length === 0) return
		if (!focusedArtifactId) {
			const first = artifactList[0]
			if (first === undefined) return
			setFocusedArtifactId(first.id, 'keyboard')
			return
		}
		const currentIndex = artifactList.findIndex((a) => a.id === focusedArtifactId)
		const nextIndex = currentIndex >= artifactList.length - 1 ? 0 : currentIndex + 1
		const next = artifactList[nextIndex]
		if (next === undefined) return
		setFocusedArtifactId(next.id, 'keyboard')
	}, [focusedArtifactId, artifactList, setFocusedArtifactId])

	const handleFocusPrevious = useCallback(() => {
		if (artifactList.length === 0) return
		if (!focusedArtifactId) {
			const last = artifactList[artifactList.length - 1]
			if (last === undefined) return
			setFocusedArtifactId(last.id, 'keyboard')
			return
		}
		const currentIndex = artifactList.findIndex((a) => a.id === focusedArtifactId)
		const nextIndex = currentIndex <= 0 ? artifactList.length - 1 : currentIndex - 1
		const prev = artifactList[nextIndex]
		if (prev === undefined) return
		setFocusedArtifactId(prev.id, 'keyboard')
	}, [focusedArtifactId, artifactList, setFocusedArtifactId])

	const handleActivateArtifact = useCallback(
		(artifact: TableArtifact) => {
			navigate({ to: '/artifacts/$artifactId', params: { artifactId: artifact.id } })
		},
		[navigate],
	)

	// Hotkeys
	useArtifactTableHotkeys({
		artifacts: artifactList,
		focusedArtifactId,
		scope: HOTKEY_SCOPES.TASK_ARTIFACTS_LIST,
		onFocusNext: handleFocusNext,
		onFocusPrevious: handleFocusPrevious,
		onActivateArtifact: handleActivateArtifact,
	})

	// Esc - go back to tasks list
	useHotkeys('Escape', () => navigate({ to: '/tasks' }), { scopes: [HOTKEY_SCOPES.TASK_ARTIFACTS_LIST] }, [navigate])

	if (artifactList.length === 0 && isError) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-center">
					<p className="text-destructive mb-4">Failed to load artifacts</p>
					<button
						onClick={() => window.location.reload()}
						className="text-sm text-muted-foreground hover:underline"
					>
						Retry
					</button>
				</div>
			</div>
		)
	}

	if (artifactList.length === 0 && isLoading) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-3">
				<SyncGridAnimation variant="snake" speed={120} className="w-8 text-muted-foreground" />
				<p className="text-sm text-muted-foreground">Loading artifacts...</p>
			</div>
		)
	}

	// Task not found: collection is synced but task doesn't exist
	if (!task && isTaskReady) {
		return (
			<div className="flex items-center justify-center h-full">
				<Card className="p-8 text-center max-w-md">
					<FileQuestion className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
					<h2 className="font-mono uppercase tracking-wider mb-2">Task Not Found</h2>
					<p className="text-sm text-muted-foreground mb-6">This task may be in a different organization.</p>
					<div className="flex flex-col gap-3 items-center">
						<OrganizationSwitcher />
						<Button variant="ghost" size="sm" asChild>
							<Link to="/tasks">Back to Tasks</Link>
						</Button>
					</div>
				</Card>
			</div>
		)
	}

	return (
		<HotkeyScopeBoundary scope={HOTKEY_SCOPES.TASK_ARTIFACTS_LIST} componentName="TaskArtifactsPage">
			<div className="p-6">
				<ArtifactTable
					artifacts={artifactList}
					isLoading={isLoading}
					focusedArtifactId={focusedArtifactId}
					onFocusArtifact={(artifact) => {
						if (shouldIgnoreMouseEvent()) return
						setFocusedArtifactId(artifact.id, 'mouse')
					}}
					onBlurArtifact={() => {}}
				/>
			</div>
		</HotkeyScopeBoundary>
	)
}
