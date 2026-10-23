import { DiffCommentPanelCard } from '@humanlayer/ui/components/diff-review/diff-comment-panel-card'
import {
	DiffCommentsPanel,
	type DiffCommentsPanelFilter,
} from '@humanlayer/ui/components/diff-review/diff-comments-panel'
import { DiffHeaderBar } from '@humanlayer/ui/components/diff-review/diff-header-bar'
import { DiffFileTree } from '@humanlayer/ui/components/diff-review/DiffFileTree'
import { useDiffStyle } from '@humanlayer/ui/components/diff-style-provider'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@humanlayer/ui/components/resizable'
import { extractDiffCommentExcerpts } from '@humanlayer/ui/lib/diff-review/diff-comment-excerpt'
import { taskDiffDisplayPath } from '@humanlayer/ui/lib/diff-review/task-diff-display-path'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useDefaultLayout } from 'react-resizable-panels'

import { DiffFeedbackDelivery } from '@/components/diffs/delivery/DiffFeedbackDelivery'
import {
	type DiffFeedbackDeliveryTarget,
	useDiffFeedbackDelivery,
} from '@/components/diffs/delivery/use-diff-feedback-delivery'
import { TaskDiffDeepLinkFocusApplier } from '@/components/diffs/TaskDiffDeepLinkApplier'
import { WiredOpenPullRequestBar } from '@/components/diffs/WiredOpenPullRequestBar'
import { WiredTaskDiffCodeViewStack } from '@/components/diffs/WiredTaskDiffCodeViewStack'
import { useDiffCommentActions } from '@/hooks/diffs/useDiffCommentActions'
import { useFittedDiffStyle } from '@/hooks/diffs/useFittedDiffStyle'
import { type FullscreenDiffPane, useFullscreenDiffPaneNavigation } from '@/hooks/diffs/useFullscreenDiffPaneNavigation'
import { getTaskDiffAnchorComparison, withOmittedReasons } from '@/hooks/diffs/useTaskDiffComparisons'
import { useTaskDiffFileVisibility } from '@/hooks/diffs/useTaskDiffFileVisibility'
import {
	type TaskDiffNavigationController,
	useTaskDiffNavigationController,
} from '@/hooks/diffs/useTaskDiffNavigationController'
import type { TaskDiffReviewModel } from '@/hooks/diffs/useTaskDiffReviewModel'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { hasMacWindowControls, hasTauriChrome, MAC_WINDOW_CONTROLS_INSET_CLASS } from '@/lib/tauri-chrome'
import { copySessionDeepLink, copyTaskDeepLink, type DiffShareSearch } from '@/utils/sharing-links'

import { registerTaskDiffFileNavigator } from './task-diff-navigation-registry'

export interface TaskDiffReviewWorkspaceProps {
	model: TaskDiffReviewModel
	onClose: () => void
	isFullscreen?: boolean
	onFullscreenToggle: () => void
	showFileTree?: boolean
	deliveryTarget?: DiffFeedbackDeliveryTarget
}

/** Owns the interaction between the optional file tree and the mounted diff pane. */
export function TaskDiffReviewWorkspace({
	model,
	onClose,
	isFullscreen = false,
	onFullscreenToggle,
	showFileTree = false,
	deliveryTarget = { kind: 'task' },
}: TaskDiffReviewWorkspaceProps) {
	const { diffStyle: sharedDiffStyle, setDiffStyle: setSharedDiffStyle } = useDiffStyle()
	const fullscreenDiffStyle = useSettingsStore((state) => state.diffStyleFullscreen)
	const setFullscreenDiffStyle = useSettingsStore((state) => state.setDiffStyleFullscreen)
	const preferredDiffStyle = isFullscreen ? fullscreenDiffStyle : sharedDiffStyle
	const { diffStyle, splitFits, paneRef: diffPaneRef } = useFittedDiffStyle(preferredDiffStyle)
	const setDiffStyle = isFullscreen ? setFullscreenDiffStyle : setSharedDiffStyle
	const requestedFileId =
		model.deepLinkTarget?.status === 'ready' || model.deepLinkTarget?.status === 'missing-file'
			? model.deepLinkTarget.fileId
			: (model.deepLinkTarget?.requestedFileId ?? null)
	const {
		files,
		visibleFiles,
		reviewedIds,
		selectedVisibleFileId,
		hideReviewed,
		setHideReviewed,
		fileSort,
		setFileSort,
	} = useTaskDiffFileVisibility(requestedFileId)
	const [fullscreenPaneOwner, setFullscreenPaneOwner] = useState<FullscreenDiffPane>('editor')
	const fullscreenEditorPaneRef = useRef<HTMLDivElement>(null)
	const focusFullscreenEditor = useCallback(() => {
		setFullscreenPaneOwner('editor')
		fullscreenEditorPaneRef.current?.focus({ preventScroll: true })
	}, [])
	const navigation = useTaskDiffNavigationController(model, diffStyle, requestedFileId, {
		isFullscreen,
		navigationEnabled: !isFullscreen || fullscreenPaneOwner === 'editor',
	})
	const navigateToFileRef = useRef(navigation.navigateToFile)
	navigateToFileRef.current = navigation.navigateToFile
	useMountEffect(() => {
		const placement = model.activePlacement
		if (!placement) return
		return registerTaskDiffFileNavigator(model.taskId, placement, {
			navigateToFile: (fileId) => navigateToFileRef.current(fileId),
		})
	})
	const [codeViewReady, setCodeViewReady] = useState(false)
	const interactions = useDiffCommentActions(model.resourceOwnerUserId)
	const { user } = useAuth()
	const [commentsPanelChoice, setCommentsPanelChoice] = useState(true)
	const [commentsFilter, setCommentsFilter] = useState<DiffCommentsPanelFilter>('unresolved')
	const commentsPanelOpen = isFullscreen && commentsPanelChoice
	const toggleCommentsPanel = useCallback(() => {
		setCommentsPanelChoice(!commentsPanelOpen)
		if (commentsPanelOpen) focusFullscreenEditor()
	}, [commentsPanelOpen, focusFullscreenEditor])
	const delivery = useDiffFeedbackDelivery({
		taskId: model.taskId,
		threads: model.comments.threads,
		target: deliveryTarget,
		hotkeyScopes: [
			isFullscreen
				? HOTKEY_SCOPES.DIFF_FULLSCREEN
				: deliveryTarget.kind === 'session'
					? HOTKEY_SCOPES.SESSION_DIFF_REVIEW
					: HOTKEY_SCOPES.TASK_DETAIL,
		],
	})
	const selectedFile = visibleFiles.find((file) => file.id === selectedVisibleFileId)
	const currentUserDisplayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'You'
	const { deliverThread } = delivery
	const handleDeliverThread = useCallback(
		(input: { rootCommentId: string; mode: 'send' | 'send-and-resolve' }) =>
			deliverThread(input.rootCommentId, input.mode),
		[deliverThread],
	)
	const setCodeViewHandle = useCallback(
		(handle: Parameters<typeof navigation.setCodeViewHandle>[0]) => {
			navigation.setCodeViewHandle(handle)
			setCodeViewReady(handle !== null)
		},
		[navigation.setCodeViewHandle],
	)
	const deepLinkTarget = model.deepLinkTarget
	const diffPresentation = isFullscreen
		? 'fullscreen'
		: (model.activePresentation ?? model.activePlacement ?? 'sidebar')
	const copyDiffLink = useCallback(
		(search: DiffShareSearch) => {
			const target = { diffPresentation, ...search }
			return deliveryTarget.kind === 'session'
				? copySessionDeepLink(deliveryTarget.sessionId, target)
				: copyTaskDeepLink(model.taskId, target)
		},
		[deliveryTarget, diffPresentation, model.taskId],
	)
	const handleCopyCommentLink = useCallback(
		({ rootCommentId }: { rootCommentId: string }) => {
			const thread = model.comments.threads.find((candidate) => candidate.root.id === rootCommentId)
			if (!thread) return
			const anchor = thread.root.anchor_json
			const fileId =
				'fileId' in thread.placement
					? thread.placement.fileId
					: anchor
						? `${model.taskId}:${anchor.repoId}:${anchor.path}`
						: undefined
			void copyDiffLink({ diffFileId: fileId, diffCommentId: rootCommentId })
		},
		[copyDiffLink, model.comments.threads, model.taskId],
	)
	const commentExcerpts = useMemo(
		() =>
			commentsPanelOpen
				? extractDiffCommentExcerpts(model.comments.threads, (anchor) =>
						getTaskDiffAnchorComparison(anchor, model.versions),
					)
				: null,
		[commentsPanelOpen, model.comments.threads, model.versions],
	)
	const stackFiles = useMemo(
		() => withOmittedReasons(visibleFiles, model.omittedFileIds),
		[model.omittedFileIds, visibleFiles],
	)
	const unresolvedThreadCount = useMemo(
		() => model.comments.threads.filter((thread) => !thread.root.is_resolved).length,
		[model.comments.threads],
	)

	if (deepLinkTarget?.status === 'missing-file') {
		const location = [deepLinkTarget.repoId, deepLinkTarget.path].filter(Boolean).join('/')
		return (
			<div
				className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-sm text-muted-foreground"
				role="status"
			>
				<span>Diff file unavailable</span>
				{location ? <span className="font-mono text-xs text-foreground">{location}</span> : null}
			</div>
		)
	}

	if (deepLinkTarget?.status === 'missing-comment') {
		return (
			<div
				className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground"
				role="status"
			>
				Comment unavailable
			</div>
		)
	}

	const reviewBody = getReviewBody({
		updateRequired: model.versions.protocol === 'update-required',
		hasFiles: files.rows.length > 0,
		hasVisibleFiles: visibleFiles.length > 0,
		hasSelectedFile: Boolean(selectedFile),
		hasMissingFiles: model.comments.missingFiles.length > 0,
	})
	const reviewPane = (
		<>
			{codeViewReady && deepLinkTarget?.status === 'ready' ? (
				<TaskDiffDeepLinkFocusApplier
					key={`${deepLinkTarget.presentation}:${deepLinkTarget.fileId ?? ''}:${deepLinkTarget.rootCommentId ?? ''}`}
					target={deepLinkTarget}
					applyDeepLinkTarget={navigation.applyDeepLinkTarget}
				/>
			) : null}
			{deliveryTarget.kind === 'session' ? (
				<DiffFeedbackDelivery sessionId={deliveryTarget.sessionId} model={delivery} />
			) : null}
			<div
				ref={diffPaneRef}
				className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background font-mono"
				aria-label="Task diff review"
			>
				<DiffHeaderBar
					diffStyle={diffStyle}
					onDiffStyleChange={setDiffStyle}
					splitViewFits={splitFits}
					reviewedCount={reviewedIds.size}
					totalCount={files.rows.length}
					collapsedCount={model.collapsedIds.size}
					reviewedLines={model.reviewedLines}
					totalLines={model.totalLines}
					hideReviewed={hideReviewed}
					onHideReviewedChange={setHideReviewed}
					fileSort={fileSort}
					onFileSortChange={setFileSort}
					comparison={model.comparison}
					onComparisonChange={model.setComparison}
					reviewActions={model.reviewActions}
					openCommentCount={model.comments.openRootCount}
					deliveryCapability={delivery.capability}
					deliveryMode={delivery.mode}
					onDeliveryModeChange={delivery.setMode}
					onDeliverComments={delivery.deliverAll}
					onCopyComments={delivery.copyAll}
					deliveryPending={delivery.pending}
					deliveryError={delivery.error}
					onResolveSentComments={delivery.resolveSentComments}
					onCopyReviewLink={() => void copyDiffLink({})}
					commentsPanelOpen={commentsPanelOpen}
					onCommentsPanelToggle={isFullscreen ? toggleCommentsPanel : undefined}
					isFullscreen={isFullscreen}
					onFullscreenToggle={onFullscreenToggle}
					onClose={onClose}
				/>
				{reviewBody === 'update-required' ? <TaskDiffUpdateRequired /> : null}
				{reviewBody === 'all-reviewed' ? (
					<div
						className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground"
						role="status"
					>
						All changed files have been reviewed.
					</div>
				) : null}
				{reviewBody === 'selection-unavailable' ? (
					<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
						The selected diff is no longer available.
					</div>
				) : null}
				{reviewBody === 'stack' ? (
					<WiredTaskDiffCodeViewStack
						ref={setCodeViewHandle}
						files={stackFiles}
						comparisons={model.comparisons}
						comments={model.comments}
						diffStyle={diffStyle}
						reviewedIds={reviewedIds}
						collapsedIds={model.collapsedIds}
						isFullscreen={isFullscreen}
						taskId={model.taskId}
						currentUserId={user?.id}
						currentUserDisplayName={currentUserDisplayName}
						currentUserAvatarUrl={user?.profilePictureUrl ?? undefined}
						deliveryMode={delivery.mode}
						deliveryCapability={delivery.capability}
						onDeliveryModeChange={delivery.setMode}
						onCreateComment={interactions.create}
						onReplyComment={interactions.reply}
						onEditComment={interactions.edit}
						onDeleteComment={interactions.remove}
						onResolveComment={interactions.resolve}
						onDeliverThread={handleDeliverThread}
						onPointerMove={navigation.onPointerMove}
						onPointerTarget={navigation.onPointerTarget}
						onPointerRangeChange={navigation.onPointerRangeChange}
						onPointerReviewAction={navigation.onPointerReviewAction}
						onOpenInEditor={model.openFileInEditor}
						onCopyFileLink={(file) => void copyDiffLink({ diffFileId: file.id })}
						onCopyFilePath={model.copyFilePath}
						onCopyCommentLink={handleCopyCommentLink}
						onReviewedChange={navigation.onReviewedChange}
						onCollapsedChange={model.setCollapsed}
					/>
				) : null}
				{/* Below the hotkey hints, which come and go with the focused target: anchored above
				    them the bar would move under the reader as they navigate. */}
				<WiredOpenPullRequestBar
					target={deliveryTarget}
					taskId={model.taskId}
					openCommentCount={model.comments.openRootCount}
				/>
			</div>
		</>
	)

	if (!showFileTree) return reviewPane

	const visiblePanelThreads =
		commentsFilter === 'unresolved'
			? model.comments.threads.filter((thread) => !thread.root.is_resolved)
			: model.comments.threads
	const commentsPanel = commentsPanelOpen ? (
		<DiffCommentsPanel
			filter={commentsFilter}
			onFilterChange={setCommentsFilter}
			unresolvedCount={unresolvedThreadCount}
			totalCount={model.comments.threads.length}
			onClose={() => {
				setCommentsPanelChoice(false)
				focusFullscreenEditor()
			}}
		>
			{visiblePanelThreads.map((thread) => (
				<DiffCommentPanelCard
					key={thread.root.id}
					thread={thread}
					excerpt={commentExcerpts?.get(thread.root.id)}
					onJumpToThread={navigation.navigateToThread}
					taskId={model.taskId}
					currentUserId={user?.id}
					currentUserDisplayName={currentUserDisplayName}
					currentUserAvatarUrl={user?.profilePictureUrl ?? undefined}
					deliveryMode={delivery.mode}
					deliveryCapability={delivery.capability}
					onDeliveryModeChange={delivery.setMode}
					onReply={interactions.reply}
					onEdit={interactions.edit}
					onDelete={interactions.remove}
					onResolve={interactions.resolve}
					onDeliver={handleDeliverThread}
					onCopyLink={handleCopyCommentLink}
				/>
			))}
		</DiffCommentsPanel>
	) : null

	const selectedPath = selectedFile ? taskDiffDisplayPath(selectedFile) : null
	return (
		<FullscreenDiffReviewLayout
			model={model}
			requestedFileId={requestedFileId}
			selectedPath={selectedPath}
			onSelectFile={navigation.navigateToFile}
			reviewPane={reviewPane}
			commentsPanel={commentsPanel}
			paneOwner={fullscreenPaneOwner}
			onPaneOwnerChange={setFullscreenPaneOwner}
			onOpenComments={() => setCommentsPanelChoice(true)}
			editorPaneRef={fullscreenEditorPaneRef}
		/>
	)
}

function FullscreenDiffReviewLayout({
	model,
	requestedFileId,
	selectedPath,
	onSelectFile,
	reviewPane,
	commentsPanel,
	paneOwner,
	onPaneOwnerChange,
	onOpenComments,
	editorPaneRef,
}: {
	model: TaskDiffReviewModel
	requestedFileId: string | null
	selectedPath: string | null
	onSelectFile: TaskDiffNavigationController['navigateToFile']
	reviewPane: React.ReactNode
	commentsPanel?: React.ReactNode
	paneOwner: FullscreenDiffPane
	onPaneOwnerChange: (owner: FullscreenDiffPane) => void
	onOpenComments: () => void
	editorPaneRef: React.RefObject<HTMLDivElement | null>
}) {
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'diff-fullscreen-review' })
	const { files, visibleFiles, treeOrder } = useTaskDiffFileVisibility(requestedFileId)
	const paneNavigation = useFullscreenDiffPaneNavigation({
		enabled: model.activePresentation === 'fullscreen',
		owner: paneOwner,
		setOwner: onPaneOwnerChange,
		commentsOpen: Boolean(commentsPanel),
		openComments: onOpenComments,
		editorPaneRef,
	})
	const paneClassName = (pane: FullscreenDiffPane) =>
		`h-full min-h-0 overflow-hidden ${paneOwner === pane ? 'bg-accent/10' : ''}`

	return (
		<ResizablePanelGroup
			orientation="horizontal"
			className="min-h-0 min-w-0 flex-1"
			defaultLayout={defaultLayout}
			onLayoutChanged={onLayoutChanged}
		>
			<ResizablePanel id="diff-fullscreen-files" defaultSize="25%" minSize="220px" maxSize="45%">
				<div
					ref={paneNavigation.treePaneRef}
					tabIndex={-1}
					aria-label="Changed files pane"
					data-fullscreen-diff-pane="tree"
					className={`${paneClassName('tree')} flex flex-col bg-foreground/3 outline-none`}
					onPointerDownCapture={() => paneNavigation.own('tree')}
					onFocusCapture={() => paneNavigation.own('tree')}
				>
					<div
						data-tauri-drag-region={hasTauriChrome() ? 'deep' : undefined}
						className={`flex h-9 shrink-0 items-center pr-3 text-xs font-medium uppercase tracking-wide text-muted-foreground ${hasMacWindowControls() ? MAC_WINDOW_CONTROLS_INSET_CLASS : 'pl-3'}`}
					>
						<span className="truncate">Changed files</span>
					</div>
					<div className="min-h-0 flex-1 overflow-hidden">
						<DiffFileTree
							ref={paneNavigation.treeRef}
							files={visibleFiles.map((file) => ({
								path: taskDiffDisplayPath(file),
								status: file.changeType,
								openCommentCount: model.comments.openRootCountByFile.get(file.id),
							}))}
							selectedPath={selectedPath}
							order={treeOrder}
							onSelectFile={(path) => {
								const file = visibleFiles.find((candidate) => taskDiffDisplayPath(candidate) === path)
								if (file) onSelectFile(file.id)
							}}
							status={files.status}
							error={files.error}
						/>
					</div>
				</div>
			</ResizablePanel>
			<ResizableHandle withHandle />
			<ResizablePanel id="diff-fullscreen-content" defaultSize="75%" minSize="40%">
				<div
					ref={paneNavigation.editorPaneRef}
					tabIndex={-1}
					aria-label="Diff editor pane"
					data-fullscreen-diff-pane="editor"
					className={`${paneClassName('editor')} outline-none`}
					onPointerDownCapture={() => paneNavigation.own('editor')}
					onFocusCapture={() => paneNavigation.own('editor')}
				>
					{reviewPane}
				</div>
			</ResizablePanel>
			{commentsPanel ? (
				<>
					<ResizableHandle withHandle />
					<ResizablePanel id="diff-fullscreen-comments" defaultSize="24%" minSize="280px" maxSize="45%">
						<div
							ref={paneNavigation.commentsPaneRef}
							tabIndex={-1}
							aria-label="Comments pane"
							data-fullscreen-diff-pane="comments"
							className={`${paneClassName('comments')} outline-none`}
							onPointerDownCapture={() => paneNavigation.own('comments')}
							onFocusCapture={() => paneNavigation.own('comments')}
						>
							{commentsPanel}
						</div>
					</ResizablePanel>
				</>
			) : null}
		</ResizablePanelGroup>
	)
}

type ReviewBody = 'update-required' | 'all-reviewed' | 'selection-unavailable' | 'stack'

function getReviewBody(state: {
	updateRequired: boolean
	hasFiles: boolean
	hasVisibleFiles: boolean
	hasSelectedFile: boolean
	hasMissingFiles: boolean
}): ReviewBody {
	if (state.updateRequired) return 'update-required'
	if (state.hasFiles && !state.hasVisibleFiles && !state.hasMissingFiles) return 'all-reviewed'
	if (!state.hasSelectedFile && !state.hasMissingFiles) return 'selection-unavailable'
	return 'stack'
}

/**
 * The task's host runs a daemon that still writes patch-only diffs, which this version no longer
 * renders. The scope keeps checking, so the diff appears once that daemon updates.
 */
function TaskDiffUpdateRequired() {
	return (
		<div
			className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center text-sm text-muted-foreground"
			role="status"
		>
			<span className="text-foreground">Update HumanLayer to see these changes</span>
			<span>
				This task&apos;s host runs an older daemon. Update HumanLayer on that host and the diff appears here.
			</span>
		</div>
	)
}
