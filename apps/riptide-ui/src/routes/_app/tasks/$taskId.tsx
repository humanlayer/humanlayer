import { useIsMobile } from '@humanlayer/ui/hooks/use-mobile'
import { createFileRoute } from '@tanstack/react-router'
import z from 'zod/v4'

import { DesktopTaskDetailPage } from '@/components/task-detail/DesktopTaskDetailPage'
import { useMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { useDeepLinkHandoff } from '@/hooks/useDeepLinkHandoff'
import { optionalBooleanSearchParam } from '@/lib/search-params'
import { MinimalistTaskPage } from '@/minimalist/components/TaskPage'
import { WiredMobileTaskDetailPage } from '@/mobile/pages/wired/WiredMobileTaskDetailPage'

export const taskDetailSearchSchema = z.object({
	session: z.string().optional(),
	view: z.literal('changes').optional(),
	pr: optionalBooleanSearchParam,
	from: z.enum(['archive-tasks']).optional(),
	artifactId: z.string().optional(),
	commentId: z.string().optional(),
	/** V2 comment deep link: one-shot reveal of a root/reply ID (with artifactId). */
	comment: z.string().optional(),
	headingId: z.string().optional(),
	focus: z.literal('workspace').optional(),
	/** With artifactId: open the artifact viewer fullscreen on load. */
	fullscreen: optionalBooleanSearchParam,
	diffFileId: z.string().optional(),
	diffCommentId: z.string().optional(),
	diffPresentation: z.enum(['sidebar', 'primary', 'fullscreen']).optional(),
	deep: z.boolean().optional(),
})

export const Route = createFileRoute('/_app/tasks/$taskId')({
	validateSearch: taskDetailSearchSchema,
	component: TaskDetailPage,
	loader: ({ params, context, location }) => {
		// Skip preloading for archived tasks (from archive pages)
		const searchParams = new URLSearchParams(location.search)
		const isFromArchive = searchParams.get('from') === 'archive-tasks'
		context.preloadService?.preloadTaskDetail(params.taskId, isFromArchive)
	},
})

function TaskDetailPage() {
	const minimalist = useMinimalistLayout()
	const { taskId } = Route.useParams()
	const { session } = Route.useSearch()
	if (minimalist) return <MinimalistTaskPage key={taskId} taskId={taskId} sessionId={session} />
	return <StandardTaskDetailPage />
}

function StandardTaskDetailPage() {
	const { taskId } = Route.useParams()
	const { deep, from, artifactId, commentId, fullscreen, focus, diffFileId, diffCommentId, diffPresentation } =
		Route.useSearch()
	useDeepLinkHandoff(`nav/tasks/${taskId}`, deep)
	const isMobile = useIsMobile()
	if (isMobile) return <WiredMobileTaskDetailPage taskId={taskId} />
	return (
		<DesktopTaskDetailPage
			key={taskId}
			taskId={taskId}
			from={from}
			searchArtifactId={artifactId ?? null}
			searchCommentId={commentId ?? null}
			searchFullscreen={fullscreen ?? null}
			searchDiff={{
				diffFileId: diffFileId ?? null,
				diffCommentId: diffCommentId ?? null,
				diffPresentation: diffPresentation ?? null,
			}}
			searchFocus={focus}
		/>
	)
}
