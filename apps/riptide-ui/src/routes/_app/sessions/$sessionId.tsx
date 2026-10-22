import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@humanlayer/ui/components/resizable'
import { useIsMobile } from '@humanlayer/ui/hooks/use-mobile'
import { createFileRoute } from '@tanstack/react-router'
import z from 'zod/v4'

import { AppBreadcrumb } from '@/components/AppBreadcrumb'
import { DeepLinkArtifactApplier } from '@/components/DeepLinkArtifactApplier'
import { SessionDiffReviewSurface } from '@/components/diffs/SessionDiffReviewSurface'
import { TaskDiffDeepLinkPresentationApplier } from '@/components/diffs/TaskDiffDeepLinkApplier'
import { TaskDiffReviewWorkspace } from '@/components/diffs/TaskDiffReviewWorkspace'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { useOptionalSessionDiff } from '@/components/session-detail/session-diff-context'
import { SessionArtifactReconciler } from '@/components/session-detail/SessionArtifactReconciler'
import { SessionConversationPanel } from '@/components/session-detail/SessionConversationPanel'
import { SessionDetailProvider } from '@/components/session-detail/SessionDetailProvider'
import { SessionFocusSync } from '@/components/session-detail/SessionFocusSync'
import { SessionOverlays } from '@/components/session-detail/SessionOverlays'
import { SessionPromptArea } from '@/components/session-detail/SessionPromptArea'
import { SessionSidebarPanel } from '@/components/session-detail/SessionSidebarPanel'
import { WiredSessionMainColumn } from '@/components/session-detail/WiredSessionMainColumn'
import { WiredFirstSessionHotkeysGuide } from '@/components/WiredFirstSessionHotkeysGuide'
import { WiredPhaseTipModal } from '@/components/WiredPhaseTipModal'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useDiffFullscreenDialogOpen } from '@/hooks/stores/taskDiffReviewStore'
import { useMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { useDeepLinkHandoff } from '@/hooks/useDeepLinkHandoff'
import { optionalBooleanSearchParam } from '@/lib/search-params'
import { MinimalistSessionPage } from '@/minimalist/components/SessionPage'
import { WiredMobileSessionDetailPage } from '@/mobile/pages/wired/WiredMobileSessionDetailPage'

export const sessionDetailSearchSchema = z.object({
	from: z.enum(['archive-sessions', 'archive-tasks']).optional(),
	artifactId: z.string().optional(),
	commentId: z.string().optional(),
	/** V2 comment deep link: one-shot reveal of a root/reply ID (with artifactId). */
	comment: z.string().optional(),
	diffFileId: z.string().optional(),
	diffCommentId: z.string().optional(),
	diffPresentation: z.enum(['sidebar', 'primary', 'fullscreen']).optional(),
	headingId: z.string().optional(),
	fullscreen: optionalBooleanSearchParam,
	deep: z.boolean().optional(),
})

export const Route = createFileRoute('/_app/sessions/$sessionId')({
	validateSearch: sessionDetailSearchSchema,
	component: SessionDetailPage,
	loader: ({ params, context, location }) => {
		// Skip preloading for archived sessions (from archive pages)
		const searchParams = new URLSearchParams(location.search)
		const isFromArchive = searchParams.get('from')?.startsWith('archive-')
		context.preloadService?.preloadSessionDetail(params.sessionId, isFromArchive)
	},
})

function SessionDetailPage() {
	const minimalist = useMinimalistLayout()
	const { sessionId } = Route.useParams()
	if (minimalist) return <MinimalistSessionPage sessionId={sessionId} />
	return <StandardSessionDetailPage />
}

function StandardSessionDetailPage() {
	const { sessionId } = Route.useParams()
	const { deep, diffFileId, diffCommentId, diffPresentation } = Route.useSearch()
	useDeepLinkHandoff(`nav/sessions/${sessionId}`, deep)
	const isMobile = useIsMobile()
	if (isMobile) return <WiredMobileSessionDetailPage sessionId={sessionId} />
	return (
		<>
			{/* Siblings must not share a key; both remount per session via distinct keys. */}
			<SessionFocusSync key={`focus-${sessionId}`} sessionId={sessionId} />
			<SessionDetailProvider
				key={sessionId}
				sessionId={sessionId}
				searchDiff={{
					diffFileId: diffFileId ?? null,
					diffCommentId: diffCommentId ?? null,
					diffPresentation: diffPresentation ?? null,
				}}
			>
				<SessionDetailLayout />
				<SessionPhaseTipModal />
			</SessionDetailProvider>
		</>
	)
}

function SessionPhaseTipModal() {
	const { session, conversation } = useSessionDetail()
	return <WiredPhaseTipModal session={session} events={conversation.events} />
}

/** Pure layout — every panel pulls its own state from useSessionDetail(). */
function SessionDetailLayout() {
	const { sessionId, artifactPanel } = useSessionDetail()
	const diffFullscreenOpen = useDiffFullscreenDialogOpen()
	const taskDiffReview = useOptionalSessionDiff()
	const { artifactId: searchArtifactId, commentId: searchCommentId, fullscreen: searchFullscreen } = Route.useSearch()
	const pendingFullscreenArtifactId = searchFullscreen ? searchArtifactId : undefined

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.SESSION_DETAIL}
			isActive={taskDiffReview?.activePresentation !== 'fullscreen'}
			componentName="SessionDetailPage"
		>
			<SessionArtifactReconciler key={sessionId} />
			<WiredFirstSessionHotkeysGuide />
			{taskDiffReview?.deepLinkTarget && taskDiffReview.deepLinkTarget.status !== 'pending' ? (
				<TaskDiffDeepLinkPresentationApplier
					key={`${taskDiffReview.deepLinkTarget.presentation}:${taskDiffReview.deepLinkTarget.requestedFileId ?? ''}:${taskDiffReview.deepLinkTarget.status === 'ready' ? (taskDiffReview.deepLinkTarget.rootCommentId ?? '') : (taskDiffReview.deepLinkTarget.requestedCommentId ?? '')}`}
					target={taskDiffReview.deepLinkTarget}
					onApply={(target) => {
						const fileId =
							target.status === 'ready' || target.status === 'missing-file' ? target.fileId : undefined
						if (target.presentation === 'primary') taskDiffReview.openIn('primary', fileId ?? undefined)
						else if (target.presentation === 'sidebar') {
							taskDiffReview.openSidebar(fileId ?? undefined)
							artifactPanel.handleSidebarTabChange('diffs')
							artifactPanel.sidebarPanelRef.current?.expand()
						} else {
							taskDiffReview.openSidebar(fileId ?? undefined)
							taskDiffReview.openFullscreen()
						}
					}}
				/>
			) : null}
			{searchArtifactId && (
				<DeepLinkArtifactApplier
					key={`${searchArtifactId}:${searchCommentId ?? ''}:${searchFullscreen ?? false}`}
					artifactId={searchArtifactId}
					commentId={searchCommentId}
					fullscreen={searchFullscreen}
					onApply={artifactPanel.applyDeepLinkArtifact}
				/>
			)}
			<div className="flex h-full min-h-0 flex-col overflow-hidden">
				{/* Main content area */}
				<ResizablePanelGroup
					orientation="horizontal"
					disabled={diffFullscreenOpen}
					className="h-auto min-h-0 flex-1 overflow-hidden"
					defaultLayout={artifactPanel.rightSidebarDefaultLayout}
				>
					{/* Left column: Conversation + Input + Terminal */}
					<ResizablePanel id="main" defaultSize="80%">
						<WiredSessionMainColumn>
							{/* The breadcrumb lives inside the main column (not the app shell)
							    so the right sidebar can run the full window height. */}
							<AppBreadcrumb
								rightSidebarOpen={!artifactPanel.isSidebarCollapsed}
								onToggleRightSidebar={artifactPanel.expandSidebar}
							/>
							{taskDiffReview && (
								<HotkeyScopeBoundary
									scope={HOTKEY_SCOPES.SESSION_DIFF_REVIEW}
									isActive={taskDiffReview.mode === 'diff'}
									rootScopeDisabled
									componentName="SessionDiffReview"
								>
									<SessionDiffReviewSurface
										mode={taskDiffReview.mode}
										conversation={<SessionConversationPanel />}
										diff={
											<TaskDiffReviewWorkspace
												model={taskDiffReview}
												onClose={taskDiffReview.closePrimary}
												onFullscreenToggle={taskDiffReview.openFullscreen}
												deliveryTarget={{ kind: 'session', sessionId }}
											/>
										}
										prompt={
											<SessionPromptArea isConversationAbove={taskDiffReview.mode !== 'diff'} />
										}
									/>
								</HotkeyScopeBoundary>
							)}
							{!taskDiffReview && (
								<>
									<SessionConversationPanel />
									<SessionPromptArea />
								</>
							)}
						</WiredSessionMainColumn>
					</ResizablePanel>

					<ResizableHandle withHandle />

					{/* Right column: Sidebar with nested artifact viewer */}
					<SessionSidebarPanel pendingFullscreenArtifactId={pendingFullscreenArtifactId} />
				</ResizablePanelGroup>

				<SessionOverlays pendingFullscreenArtifactId={pendingFullscreenArtifactId} />
			</div>
		</HotkeyScopeBoundary>
	)
}
