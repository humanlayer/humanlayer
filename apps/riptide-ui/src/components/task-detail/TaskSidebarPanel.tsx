import { ResizablePanel } from '@humanlayer/ui/components/resizable'
import { TabsContent } from '@humanlayer/ui/components/tabs'
import type { WorkflowSession } from '@humanlayer/ui/components/workflow-graph'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback, useMemo, useState } from 'react'

import { TaskDiffChangesContent } from '@/components/diffs/TaskDiffChangesContent'
import { TaskDiffReviewWorkspace } from '@/components/diffs/TaskDiffReviewWorkspace'
import { pullRequestScopeKey } from '@/components/github/pull-request-branch'
import { WiredGitHubTab } from '@/components/github/WiredGitHubTab'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { focusMainAndReleaseSpatialDomFocus, focusRightPaneSurface } from '@/components/keyboard-focus-transfer'
import {
	ProjectWorkspaceAttentionMonitor,
	WiredProjectWorkspaceTab,
} from '@/components/project-workspace/WiredProjectWorkspaceTab'
import { useSync } from '@/components/providers/SyncProvider'
import { RightPaneControllerRegistration } from '@/components/RightPaneControllerRegistration'
import { RightSidebarToggleButton } from '@/components/sidebar-widget/RightSidebarToggleButton'
import { getVisibleSidebarTabs } from '@/components/sidebar-widget/sidebar-tabs'
import { SidebarWidget } from '@/components/sidebar-widget/SidebarWidget'
import { SidebarWidgetHeaderStrip } from '@/components/sidebar-widget/SidebarWidgetHeaderStrip'
import { WiredWorkspaceSetupStatus } from '@/components/task-detail/WiredWorkspaceSetupStatus'
import type { TaskDiffReviewModel } from '@/hooks/diffs/useTaskDiffReviewModel'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useFocusStore } from '@/hooks/stores/focusStore'
import {
	useGitHubPanelAttention,
	useGitHubPanelFailingChecks,
	useGitHubPanelStore,
} from '@/hooks/stores/githubPanelStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import type { useTaskArtifactPanel } from '@/hooks/task-detail/useTaskArtifactPanel'
import { useTaskAutoAdvanceToggles } from '@/hooks/task-detail/useTaskAutoAdvanceToggles'
import type { LoadedTaskDetailPageState } from '@/hooks/task-detail/useTaskDetailPageState'
import { useTaskWorkflowInfo } from '@/hooks/task-detail/useTaskWorkflowInfo'
import { useGitHubStatus } from '@/hooks/useGitHubStatus'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useSidebarCycleHotkeys } from '@/hooks/useSidebarCycleHotkeys'
import { useTaskSettings } from '@/hooks/useTaskSettings'
import { deriveWorkspaceHostGroups } from '@/lib/workspace-host-groups'
import { useRiptideApi } from '@/orpc/client'

type TaskArtifactPanel = ReturnType<typeof useTaskArtifactPanel>

/**
 * The right sidebar panel on the task detail page: a full-window-height,
 * collapsible resizable panel hosting the sidebar widget (workflow graph /
 * artifacts / auto-advance). Owns the task settings, workflow info, and
 * auto-advance toggle handlers.
 */
export function TaskSidebarPanel({
	artifactPanel,
	taskDetail,
	taskDiffReview,
	suppressWorkspaceSetupAutoOpen = false,
}: {
	artifactPanel: TaskArtifactPanel
	taskDetail: LoadedTaskDetailPageState
	taskDiffReview: TaskDiffReviewModel
	suppressWorkspaceSetupAutoOpen?: boolean
}) {
	return (
		<TaskSidebarPanelForTask
			key={taskDetail.taskId}
			artifactPanel={artifactPanel}
			taskDetail={taskDetail}
			taskDiffReview={taskDiffReview}
			suppressWorkspaceSetupAutoOpen={suppressWorkspaceSetupAutoOpen}
		/>
	)
}

function TaskSidebarPanelForTask({
	artifactPanel,
	taskDetail,
	taskDiffReview,
	suppressWorkspaceSetupAutoOpen,
}: {
	artifactPanel: TaskArtifactPanel
	taskDetail: LoadedTaskDetailPageState
	taskDiffReview: TaskDiffReviewModel
	suppressWorkspaceSetupAutoOpen: boolean
}) {
	const { taskId, task, data } = taskDetail
	const isProjectWorkspace = task.workspace_id !== null
	const navigate = useNavigate()
	const workspaceHosts = useMemo(
		() =>
			isProjectWorkspace
				? []
				: deriveWorkspaceHostGroups({
						hosts: data.workspaceSetup.hosts,
						workspaceSpec: task.workspace_spec,
						workspaceState: task.workspace_state,
						currentUserHostId: data.userHostId,
					}),
		[data.userHostId, data.workspaceSetup.hosts, isProjectWorkspace, task.workspace_spec, task.workspace_state],
	)
	const enableCreatingPubliclyShareableLinks = useSettingsStore(
		(s) => s.orgSettings.enableCreatingPubliclyShareableLinks,
	)
	const diffViewerEnabled = useSettingsStore((s) => s.diffViewerEnabled)
	const scratchPadEnabled = useSettingsStore((s) => s.scratchPadEnabled)
	const hasGithubTab = useGitHubStatus() !== null
	const githubScope = useMemo(() => ({ taskId }), [taskId])
	const githubScopeKey = pullRequestScopeKey(githubScope)
	const githubFailingCheckCount = useGitHubPanelFailingChecks(githubScopeKey)
	const githubAttention = useGitHubPanelAttention(githubScopeKey)
	const githubTab = useMemo(
		() => (hasGithubTab ? { failingCheckCount: githubFailingCheckCount, attention: githubAttention } : null),
		[githubAttention, githubFailingCheckCount, hasGithubTab],
	)
	const workspaceRevision = useMemo(
		() => workspaceHosts.map((host) => `${host.hostId}@${host.setupRow?.updated_at ?? ''}`).join('|'),
		[workspaceHosts],
	)

	// Effective auto-advance settings (task-level with per-user overrides)
	const { user } = useAuth()
	const { taskUserSettingsCollection, tasksCollection } = useSync()
	const { client } = useRiptideApi()
	const { settings: taskSettings, updateAutoAdvance } = useTaskSettings({
		task,
		userId: user?.id,
		taskUserSettingsCollection,
		tasksCollection,
		api: { tasks: client.tasks },
	})

	const { workflowPhases, visibleAutoAdvanceToggles, planAutoAdvanceLabel, planAutoAdvanceTitle } =
		useTaskWorkflowInfo(task)

	// Map session table rows to WorkflowSession format for the graph
	const workflowSessions: WorkflowSession[] = useMemo(
		() =>
			data.sessions.flatMap((s): WorkflowSession[] => {
				const status = s.status
				if (status === undefined) return []
				return [
					{
						id: s.id,
						title: s.title ?? undefined,
						status,
						labelName: s.labels?.[0]?.name ?? 'rpi:todo',
						labelTitle: s.labels?.[0]?.title ?? 'todo',
						artifacts: [],
					},
				]
			}),
		[data.sessions],
	)

	const autoAdvanceToggles = useTaskAutoAdvanceToggles({ task, updateAutoAdvance })
	const isArtifactOpen = Boolean(artifactPanel.selectedArtifactId && artifactPanel.sidebarTab === 'artifacts')
	const setupRow = data.workspaceSetup.activeRow
	const shouldOpenWorkspaceSetup = !!setupRow && (setupRow.status !== 'done' || !!setupRow.error)

	// Scope boundaries stack by activation time, not DOM depth. The persisted
	// artifact selection can be present on the very first render, which would
	// activate the ARTIFACT_PANEL boundary during the initial mount commit —
	// the page-root TASK_DETAIL boundary's effect runs after it (parent
	// effects follow child effects) and would disable this scope again. Defer
	// activation one commit so this boundary always pushes above the page's.
	const [initialCommitDone, setInitialCommitDone] = useState(false)
	const [workspaceSetupOpened, setWorkspaceSetupOpened] = useState(false)
	useMountEffect(() => setInitialCommitDone(true))

	// Later-phase toggles are only shown for workflow/worktree-timing
	// combinations that reach those phases
	const onPlanToWorktreeChange = visibleAutoAdvanceToggles.has('auto_advance_plan_to_worktree')
		? autoAdvanceToggles.handlePlanToWorktreeToggle
		: undefined
	const onWorktreeToImplementationChange = visibleAutoAdvanceToggles.has('auto_advance_worktree_to_implementation')
		? autoAdvanceToggles.handleWorktreeToImplementationToggle
		: undefined
	const onImplementationToPrChange = visibleAutoAdvanceToggles.has('auto_advance_implementation_to_pr')
		? autoAdvanceToggles.handleImplementationToPrToggle
		: undefined

	const handleOpenDiffPlacement = (placement: 'sidebar' | 'primary') => {
		if (placement === 'sidebar') {
			// The Changes tree has already opened the requested file in the model.
			// Opening the sidebar again here uses this render's previous selection
			// and can replace the requested file before the diff view mounts.
			artifactPanel.handleSidebarTabChange('diffs')
		}
	}
	const handleSidebarTabChange = (tab: Parameters<typeof artifactPanel.handleSidebarTabChange>[0]) => {
		if (tab === 'github' || artifactPanel.sidebarTab === 'github') {
			useGitHubPanelStore.getState().clearAttention(githubScopeKey)
		}
		artifactPanel.handleSidebarTabChange(tab)
		if (tab === 'diffs') taskDiffReview.openSidebar()
		else if (taskDiffReview.activePlacement === 'sidebar') taskDiffReview.closeSidebar()
	}
	const handleSidebarReviewClose = () => {
		taskDiffReview.closeSidebar()
		artifactPanel.handleSidebarTabChange('changes')
	}
	const visibleSidebarTabs = useMemo(
		() =>
			getVisibleSidebarTabs({
				graph: workflowPhases.length > 0,
				artifacts: artifactPanel.sidebarArtifacts.length > 0,
				github: hasGithubTab,
				changes: diffViewerEnabled && taskDiffReview.files.rows.length > 0,
				diffs: diffViewerEnabled && taskDiffReview.files.rows.length > 0,
				workspace: isProjectWorkspace || workspaceHosts.length > 0,
				'scratch-pad': scratchPadEnabled,
				'auto-advance': true,
			}),
		[
			artifactPanel.sidebarArtifacts.length,
			diffViewerEnabled,
			hasGithubTab,
			scratchPadEnabled,
			taskDiffReview.files.rows.length,
			workflowPhases.length,
			workspaceHosts.length,
			isProjectWorkspace,
		],
	)
	const isSidebarCollapsed = useCallback(
		() => artifactPanel.sidebarPanelRef.current?.isCollapsed() ?? artifactPanel.isSidebarCollapsed,
		[artifactPanel.isSidebarCollapsed, artifactPanel.sidebarPanelRef],
	)
	const { cycleBackward: cycleSidebarBackward, cycleForward: cycleSidebarForward } = useSidebarCycleHotkeys({
		visibleTabs: visibleSidebarTabs,
		currentTab: artifactPanel.sidebarTab,
		isCollapsed: isSidebarCollapsed,
		scopes: [HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL, HOTKEY_SCOPES.ARTIFACT_V2_PANEL_REVIEW],
		enabled: taskDetail.sessionsTable.editingSessionId === null,
		onTabChange: handleSidebarTabChange,
		onCollapse: artifactPanel.collapseSidebar,
		onExpand: artifactPanel.expandSidebar,
		onFocusSidebar: () => {
			useFocusStore.getState().focusRightPane()
			requestAnimationFrame(() => focusRightPaneSurface())
		},
		onFocusMain: focusMainAndReleaseSpatialDomFocus,
	})

	const handleWorkspaceNeedsAttention = () => {
		setWorkspaceSetupOpened(true)
		artifactPanel.handleWorkspaceFocus()
	}

	return (
		<>
			<RightPaneControllerRegistration
				key={artifactPanel.rightSidebarMode}
				expand={artifactPanel.expandSidebar}
			/>
			<WorkspaceAttentionAutoOpen
				isProjectWorkspace={isProjectWorkspace}
				shouldOpenLegacyWorkspace={shouldOpenWorkspaceSetup}
				suppressed={suppressWorkspaceSetupAutoOpen}
				alreadyOpened={workspaceSetupOpened}
				hasUserChosenSidebarTab={artifactPanel.hasUserChosenSidebarTab}
				taskId={taskId}
				onNeedsAttention={handleWorkspaceNeedsAttention}
			/>
			<ResizablePanel
				id="sidebar"
				defaultSize="20%"
				collapsible
				collapsedSize={0}
				panelRef={artifactPanel.sidebarPanelRef}
				onResize={(size) => {
					artifactPanel.handleRightSidebarResize(size.asPercentage)
				}}
			>
				<div className="flex h-full min-h-0 flex-col">
					<SidebarWidgetHeaderStrip>
						<RightSidebarToggleButton
							sidebarCollapsed={false}
							onToggleSidebar={artifactPanel.collapseSidebar}
						/>
					</SidebarWidgetHeaderStrip>
					{/* Same boundary as SessionSidebarPanel: artifact-panel hotkeys
			    (j/k block focus, ⇧O outline, ⇧A switcher, search) only fire
			    while the artifact viewer is actually open in this sidebar. */}
					<div className="min-h-0 flex-1">
						<HotkeyScopeBoundary
							scope={HOTKEY_SCOPES.ARTIFACT_PANEL}
							isActive={initialCommitDone && isArtifactOpen}
							componentName="TaskArtifactViewer"
						>
							<SidebarWidget
								activeTab={artifactPanel.sidebarTab}
								onTabChange={handleSidebarTabChange}
								events={[]}
								focusedEventId={null}
								todos={[]}
								artifacts={artifactPanel.sidebarArtifacts}
								workflowSessions={workflowSessions}
								workflowPhases={workflowPhases}
								onWorkflowSessionClick={(id) =>
									navigate({ to: '/sessions/$sessionId', params: { sessionId: id } })
								}
								onArtifactClick={artifactPanel.handleArtifactClick}
								deletedArtifacts={artifactPanel.deletedArtifacts}
								onDeletedArtifactClick={artifactPanel.handleArtifactClick}
								onArtifactSelect={artifactPanel.handleArtifactClick}
								onArtifactClose={artifactPanel.handleArtifactPanelClose}
								workspaceState={task.workspace_state ?? null}
								workspaceHosts={workspaceHosts}
								workspaceContent={
									isProjectWorkspace ? <WiredProjectWorkspaceTab taskId={taskId} /> : undefined
								}
								workspaceSetupContent={(hostId, localPath) =>
									hostId === data.workspaceSetup.activeHostId ? (
										<WiredWorkspaceSetupStatus
											taskId={taskId}
											taskName={task.name}
											setup={data.workspaceSetup}
											workspaceSpec={task.workspace_spec}
											hasSession={data.sessions.length > 0}
											localPath={localPath}
										/>
									) : null
								}
								workspaceHostAction={(hostId) =>
									hostId === data.workspaceSetup.activeHostId ? (
										<WiredWorkspaceSetupStatus
											taskId={taskId}
											taskName={task.name}
											setup={data.workspaceSetup}
											workspaceSpec={task.workspace_spec}
											renderEditTrigger
										/>
									) : null
								}
								taskId={taskId}
								scratchPadStorageKey={`riptide-scratch-pad.task.${taskId}`}
								scratchPadEnabled={scratchPadEnabled}
								onScratchPadCycleBackward={cycleSidebarBackward}
								onScratchPadCycleForward={cycleSidebarForward}
								hasChangedFiles={taskDiffReview.files.rows.length > 0}
								workingDirectory={data.resolvedWorkingDirectory ?? undefined}
								currentUserId={data.userId}
								isArtifactOwner={artifactPanel.isArtifactOwner}
								canDeleteArtifacts={data.canEditTask}
								hideShareableLinkOption={!enableCreatingPubliclyShareableLinks}
								pendingScrollCommentId={artifactPanel.pendingScrollCommentId}
								onArtifactScrollComplete={() => artifactPanel.setPendingScrollCommentId(null)}
								segmentByReadWriteEdit={false}
								questionsToResearchEnabled={taskSettings.autoAdvanceQuestionsToResearch}
								onQuestionsToResearchChange={autoAdvanceToggles.handleAutoAdvanceToggle}
								researchToDesignEnabled={taskSettings.autoAdvanceResearchToDesign}
								onResearchToDesignChange={autoAdvanceToggles.handleResearchToDesignToggle}
								planToWorktreeEnabled={taskSettings.autoAdvancePlanToWorktree}
								planAutoAdvanceLabel={planAutoAdvanceLabel}
								planAutoAdvanceTitle={planAutoAdvanceTitle}
								onPlanToWorktreeChange={onPlanToWorktreeChange}
								worktreeToImplementationEnabled={taskSettings.autoAdvanceWorktreeToImplementation}
								onWorktreeToImplementationChange={onWorktreeToImplementationChange}
								implementationToPrEnabled={taskSettings.autoAdvanceImplementationToPr}
								onImplementationToPrChange={onImplementationToPrChange}
								isAutoAdvanceDisabled={!data.canEditTask}
								githubTab={githubTab}
							>
								{githubTab && (
									<WiredGitHubTab scope={githubScope} workspaceRevision={workspaceRevision} />
								)}
								<TabsContent
									value="changes"
									className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
								>
									{artifactPanel.sidebarTab === 'changes' && (
										<TaskDiffChangesContent
											model={taskDiffReview}
											allowPrimary
											onOpenPlacement={handleOpenDiffPlacement}
										/>
									)}
								</TabsContent>
								<TabsContent
									value="diffs"
									className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
								>
									{artifactPanel.sidebarTab === 'diffs' &&
										taskDiffReview.activePlacement === 'sidebar' && (
											<TaskDiffReviewWorkspace
												model={taskDiffReview}
												onClose={handleSidebarReviewClose}
												onFullscreenToggle={taskDiffReview.openFullscreen}
											/>
										)}
								</TabsContent>
							</SidebarWidget>
						</HotkeyScopeBoundary>
					</div>
				</div>
			</ResizablePanel>
		</>
	)
}

function WorkspaceSetupAutoOpenApplier({ onApply }: { onApply: () => void }) {
	useMountEffect(onApply)
	return null
}

function WorkspaceAttentionAutoOpen({
	isProjectWorkspace,
	shouldOpenLegacyWorkspace,
	suppressed,
	alreadyOpened,
	hasUserChosenSidebarTab,
	taskId,
	onNeedsAttention,
}: {
	isProjectWorkspace: boolean
	shouldOpenLegacyWorkspace: boolean
	suppressed: boolean
	alreadyOpened: boolean
	hasUserChosenSidebarTab: boolean
	taskId: string
	onNeedsAttention: () => void
}) {
	if (suppressed || alreadyOpened || hasUserChosenSidebarTab) return null
	if (isProjectWorkspace) {
		return <ProjectWorkspaceAttentionMonitor taskId={taskId} onNeedsAttention={onNeedsAttention} />
	}
	return shouldOpenLegacyWorkspace ? <WorkspaceSetupAutoOpenApplier onApply={onNeedsAttention} /> : null
}
