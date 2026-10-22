import { ArtifactFullscreenModal } from '@humanlayer/ui/components/artifact-fullscreen-modal'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@humanlayer/ui/components/resizable'
import { useNavigate } from '@tanstack/react-router'

import { AppBreadcrumb } from '@/components/AppBreadcrumb'
import { ArtifactFullscreenPanel } from '@/components/ArtifactFullscreenPanel'
import { DeepLinkArtifactApplier } from '@/components/DeepLinkArtifactApplier'
import { DiffFullscreenReview } from '@/components/diffs/DiffFullscreenReview'
import { TaskDiffDeepLinkPresentationApplier } from '@/components/diffs/TaskDiffDeepLinkApplier'
import { TaskDiffReviewWorkspace } from '@/components/diffs/TaskDiffReviewWorkspace'
import { TaskDiffScope } from '@/components/diffs/TaskDiffScope'
import { TaskMainDiffReviewSurface } from '@/components/diffs/TaskMainDiffReviewSurface'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { TaskDetailLoading, TaskDetailNotFound } from '@/components/task-detail/TaskDetailPlaceholders'
import { TaskSessionsArea } from '@/components/task-detail/TaskSessionsArea'
import { TaskSidebarPanel } from '@/components/task-detail/TaskSidebarPanel'
import { TaskSummaryCard } from '@/components/task-detail/TaskSummaryCard'
import { consumeWorkspaceFocusRequest } from '@/components/task-detail/workspace-focus-request'
import { TaskPermissionsActions } from '@/components/TaskPermissionsActions'
import { TerminalPanel } from '@/components/Terminal/TerminalPanel'
import type { TaskDiffDeepLinkSearch } from '@/hooks/diffs/useTaskDiffDeepLinkTarget'
import { useTaskDiffReviewModel } from '@/hooks/diffs/useTaskDiffReviewModel'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useDiffFullscreenDialogOpen } from '@/hooks/stores/taskDiffReviewStore'
import { useTaskArtifactPanel } from '@/hooks/task-detail/useTaskArtifactPanel'
import { useTaskDetailHotkeys } from '@/hooks/task-detail/useTaskDetailHotkeys'
import { type LoadedTaskDetailPageState, useTaskDetailPageState } from '@/hooks/task-detail/useTaskDetailPageState'
import { useMountEffect } from '@/hooks/useMountEffect'
import { copyFilePath, openFileInEditor } from '@/lib/file-opener'
import { isDesktop } from '@/lib/utils'

function WorkspaceFocusRequest({ taskId, onFocus }: { taskId: string; onFocus: () => void }) {
	const navigate = useNavigate()
	useMountEffect(() => {
		consumeWorkspaceFocusRequest('workspace', onFocus, navigate, taskId)
	})
	return null
}

type ResolvedTaskDiffDeepLinkTarget = Exclude<
	NonNullable<ReturnType<typeof useTaskDiffReviewModel>['deepLinkTarget']>,
	{ status: 'pending' }
>

function hasResolvedDiffDeepLinkTarget(
	target: ReturnType<typeof useTaskDiffReviewModel>['deepLinkTarget'],
): target is ResolvedTaskDiffDeepLinkTarget {
	return target !== null && target.status !== 'pending'
}

function getDiffDeepLinkApplicationKey(target: ResolvedTaskDiffDeepLinkTarget): string {
	return [target.presentation, target.requestedFileId ?? '', target.requestedCommentId ?? '', target.status].join(':')
}

function applyDiffDeepLinkPresentation(
	target: ResolvedTaskDiffDeepLinkTarget,
	taskDiffReview: ReturnType<typeof useTaskDiffReviewModel>,
	artifactPanel: ReturnType<typeof useTaskArtifactPanel>,
): void {
	const fileId = target.status === 'missing-comment' ? undefined : target.fileId
	if (target.presentation === 'primary') {
		taskDiffReview.openIn('primary', fileId ?? undefined)
		return
	}
	taskDiffReview.openSidebar(fileId ?? undefined)
	if (target.presentation === 'sidebar') {
		artifactPanel.handleSidebarTabChange('diffs')
		artifactPanel.sidebarPanelRef.current?.expand()
		return
	}
	taskDiffReview.openFullscreen()
}

type DesktopTaskDetailPageProps = {
	taskId: string
	from?: 'archive-tasks'
	searchArtifactId: string | null
	searchCommentId: string | null
	searchFullscreen: boolean | null
	searchDiff: TaskDiffDeepLinkSearch | null
	searchFocus?: 'workspace'
}

export function DesktopTaskDetailPage({
	taskId,
	from,
	searchArtifactId,
	searchCommentId,
	searchFullscreen,
	searchDiff,
	searchFocus,
}: DesktopTaskDetailPageProps) {
	const taskDetail = useTaskDetailPageState({ taskId, from: from ?? undefined })
	const diffFullscreenOpen = useDiffFullscreenDialogOpen()
	const { task, data, sessionsTable, terminal, taskSummaryRef, onArchiveTask } = taskDetail
	const { canEditTask, resolvedWorkingDirectory } = data
	const artifactPanel = useTaskArtifactPanel({
		taskId,
		userId: data.userId,
		searchArtifactId: searchArtifactId ?? undefined,
		hasWorkflowGraph: data.hasWorkflowGraph,
		editingSessionId: sessionsTable.editingSessionId,
	})
	useTaskDetailHotkeys({
		from: from ?? undefined,
		taskId,
		sessions: data.sessions,
		canEditTask,
		canCreateSession: data.canCreateSession,
		taskSummaryRef,
		sessionsTable,
		artifactPanel,
		onArchiveTask,
	})
	const enableCreatingPubliclyShareableLinks = useSettingsStore(
		(state) => state.orgSettings.enableCreatingPubliclyShareableLinks,
	)

	if (!task && (data.isTaskLoading || !data.isTaskReady)) return <TaskDetailLoading />
	if (!task) return <TaskDetailNotFound />

	const loadedTaskDetail: LoadedTaskDetailPageState = { ...taskDetail, task }
	const canShowTerminalPanel = isDesktop() && canEditTask && !!resolvedWorkingDirectory

	return (
		<TaskDiffScope taskId={taskId} loading={<TaskDetailLoading />} missing={<TaskDetailNotFound />}>
			{searchFocus === 'workspace' && (
				<WorkspaceFocusRequest taskId={taskId} onFocus={artifactPanel.handleWorkspaceFocus} />
			)}
			<TaskDiffPageReview
				taskId={taskId}
				searchDiff={searchDiff}
				onOpenFileInEditor={(file) =>
					openFileInEditor({
						filePath: `${file.repoId}/${file.path}`,
						workingDir: resolvedWorkingDirectory ?? undefined,
						workspaceBaseDir: task.workspace_state?.workspaceBaseDirectory,
					})
				}
				onCopyFilePath={(file) =>
					void copyFilePath({
						filePath: `${file.repoId}/${file.path}`,
						workingDir: resolvedWorkingDirectory ?? undefined,
						workspaceBaseDir: task.workspace_state?.workspaceBaseDirectory,
					})
				}
			>
				{(taskDiffReview) => (
					<HotkeyScopeBoundary
						scope={HOTKEY_SCOPES.TASK_DETAIL}
						isActive={taskDiffReview.activePresentation !== 'fullscreen'}
						componentName="TaskDetailPage"
					>
						{hasResolvedDiffDeepLinkTarget(taskDiffReview.deepLinkTarget) ? (
							<TaskDiffDeepLinkPresentationApplier
								key={getDiffDeepLinkApplicationKey(taskDiffReview.deepLinkTarget)}
								target={taskDiffReview.deepLinkTarget}
								onApply={(target) =>
									applyDiffDeepLinkPresentation(target, taskDiffReview, artifactPanel)
								}
							/>
						) : null}
						{searchArtifactId && (
							<DeepLinkArtifactApplier
								key={`${searchArtifactId}:${searchCommentId ?? ''}:${searchFullscreen ?? false}`}
								artifactId={searchArtifactId}
								commentId={searchCommentId ?? undefined}
								fullscreen={searchFullscreen ?? undefined}
								onApply={artifactPanel.applyDeepLinkArtifact}
							/>
						)}
						<div className="flex flex-col h-full min-w-0 min-h-0">
							<ResizablePanelGroup
								orientation="horizontal"
								disabled={diffFullscreenOpen}
								className="flex-1 min-h-0"
								defaultLayout={artifactPanel.rightSidebarDefaultLayout}
							>
								<ResizablePanel id="main" defaultSize="80%" minSize="40%">
									<div
										className={`flex h-full min-h-0 flex-col ${canShowTerminalPanel && !terminal.isTerminalOpen ? 'pb-0' : 'pb-4'}`}
									>
										{/* The breadcrumb lives inside the main column (not the app
										    shell) so the right sidebar can run the full window height. */}
										<AppBreadcrumb
											rightSidebarOpen={!artifactPanel.isSidebarCollapsed}
											onToggleRightSidebar={artifactPanel.expandSidebar}
										/>
										<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
											<TaskMainDiffReviewSurface
												active={taskDiffReview.activePlacement === 'primary'}
												review={
													<TaskDiffReviewWorkspace
														model={taskDiffReview}
														onClose={taskDiffReview.closePrimary}
														onFullscreenToggle={taskDiffReview.openFullscreen}
													/>
												}
												overview={
													<>
														<TaskSummaryCard
															artifactPanel={artifactPanel}
															taskDetail={loadedTaskDetail}
														/>
														<TaskSessionsArea
															artifactPanel={artifactPanel}
															taskDetail={loadedTaskDetail}
														/>
													</>
												}
											/>
											{taskDiffReview.activePlacement !== 'primary' && canShowTerminalPanel && (
												<div
													className={
														terminal.isTerminalOpen
															? 'shrink-0 -mt-3'
															: 'h-4 shrink-0 -mt-3 overflow-visible'
													}
												>
													<TerminalPanel
														storageKey={`task-${taskId}`}
														workingDirectory={resolvedWorkingDirectory}
														isOpen={terminal.isTerminalOpen}
														onClose={() => terminal.setIsTerminalOpen(false)}
														onOpen={() => terminal.setIsTerminalOpen(true)}
													/>
												</div>
											)}
										</div>
									</div>
								</ResizablePanel>
								<ResizableHandle withHandle />
								<TaskSidebarPanel
									artifactPanel={artifactPanel}
									taskDetail={loadedTaskDetail}
									taskDiffReview={taskDiffReview}
									suppressWorkspaceSetupAutoOpen={!!searchArtifactId}
								/>
							</ResizablePanelGroup>
						</div>

						{artifactPanel.isFullscreen && artifactPanel.selectedArtifactId && (
							<ArtifactFullscreenPanel
								key={artifactPanel.selectedArtifactId}
								artifactId={artifactPanel.selectedArtifactId}
								taskId={taskId}
								resourceOwnerUserId={artifactPanel.selectedArtifact?.resource_owner_user_id}
								artifact={artifactPanel.selectedArtifact}
								artifacts={artifactPanel.sidebarArtifacts}
								onArtifactSelect={artifactPanel.handleArtifactClick}
								imageUrl={artifactPanel.selectedArtifactImageUrl}
								isOwner={artifactPanel.isArtifactOwner}
								viewMode={artifactPanel.effectiveViewMode}
								onViewModeChange={artifactPanel.setViewMode}
								onClose={artifactPanel.closeFullscreen}
								hideShareableLinkOption={!enableCreatingPubliclyShareableLinks}
							/>
						)}

						{artifactPanel.isFullscreenModalOpen &&
							artifactPanel.selectedArtifact &&
							artifactPanel.selectedArtifactImageUrl && (
								<HotkeyScopeBoundary
									scope={HOTKEY_SCOPES.ARTIFACT_FULLSCREEN}
									isActive
									rootScopeDisabled
									componentName="ArtifactFullscreenModal"
								>
									<ArtifactFullscreenModal
										open
										onOpenChange={artifactPanel.setFullscreenModalOpen}
										fileName={artifactPanel.selectedArtifact.file_name ?? ''}
										url={artifactPanel.selectedArtifactImageUrl}
										iframeRenderKey={artifactPanel.selectedArtifact.last_updated_at?.toString()}
										htmlSandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
									/>
								</HotkeyScopeBoundary>
							)}
						{taskDiffReview.activePresentation === 'fullscreen' && (
							<DiffFullscreenReview model={taskDiffReview} />
						)}
						<TaskPermissionsActions taskId={taskId} />
					</HotkeyScopeBoundary>
				)}
			</TaskDiffPageReview>
		</TaskDiffScope>
	)
}

function TaskDiffPageReview({
	taskId,
	searchDiff,
	onOpenFileInEditor,
	onCopyFilePath,
	children,
}: {
	taskId: string
	searchDiff: TaskDiffDeepLinkSearch | null
	onOpenFileInEditor: NonNullable<Parameters<typeof useTaskDiffReviewModel>[1]>['openFileInEditor']
	onCopyFilePath: NonNullable<Parameters<typeof useTaskDiffReviewModel>[1]>['copyFilePath']
	children: (model: ReturnType<typeof useTaskDiffReviewModel>) => React.ReactNode
}) {
	const model = useTaskDiffReviewModel(taskId, {
		openFileInEditor: onOpenFileInEditor,
		copyFilePath: onCopyFilePath,
		deepLinkSearch: searchDiff,
	})
	return children(model)
}
