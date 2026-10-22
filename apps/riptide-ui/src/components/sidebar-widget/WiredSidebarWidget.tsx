import { hasPhaseTip } from '@humanlayer/ui/components/phase-tip-banner'
import { getVisibleMinimapEvents } from '@humanlayer/ui/components/vertical-minimap'
import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useLocalStorage } from '@uidotdev/usehooks'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { SessionDiffSidebarTabs } from '@/components/diffs/SessionDiffSidebarTabs'
import { pullRequestScopeKey } from '@/components/github/pull-request-branch'
import { WiredGitHubTab } from '@/components/github/WiredGitHubTab'
import { focusRightPaneSurface } from '@/components/keyboard-focus-transfer'
import { WiredProjectWorkspaceTab } from '@/components/project-workspace/WiredProjectWorkspaceTab'
import { useSync } from '@/components/providers/SyncProvider'
import { deriveSessionArtifactHost } from '@/components/session-detail/session-artifact-host'
import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { useOptionalSessionDiff } from '@/components/session-detail/session-diff-context'
import { WiredWorkspaceSetupStatus } from '@/components/task-detail/WiredWorkspaceSetupStatus'
import type { TaskDiffReviewModel } from '@/hooks/diffs/useTaskDiffReviewModel'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useTaskWorkspaceSetup } from '@/hooks/live-queries/useTaskWorkspaceSetup'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import {
	useGitHubPanelAttention,
	useGitHubPanelFailingChecks,
	useGitHubPanelStore,
} from '@/hooks/stores/githubPanelStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import type { DiffReviewPlacement } from '@/hooks/stores/taskDiffReviewStore'
import { useGitHubStatus } from '@/hooks/useGitHubStatus'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useSidebarCycleHotkeys } from '@/hooks/useSidebarCycleHotkeys'
import { DISMISSED_TIP_TYPES_KEY } from '@/lib/preferences'
import { deriveWorkspaceHostGroups } from '@/lib/workspace-host-groups'
import { getLatestInvokedRpiPhase } from '@/utils/phase-tips'
import { eventsToMinimapEvents, extractTodosFromEvents } from '@/utils/sidebar-transforms'

import { ForkSelectorPanel } from './ForkSelectorPanel'
import { getVisibleSidebarTabs, type SidebarTab } from './sidebar-tabs'
import { SidebarWidget } from './SidebarWidget'

// Cycling the sidebar with s/⇧S moves keyboard focus to match: a cycle that
// keeps the sidebar open focuses it; one that collapses it returns to MAIN.
const focusSidebarPane = () => {
	useFocusStore.getState().focusRightPane()
	requestAnimationFrame(() => focusRightPaneSurface())
}
const focusMainPane = () => useFocusStore.getState().focusMain()

interface SessionDiffSidebarOptions {
	hasDiffReview: boolean
	hasGithub: boolean
	/** Opening the GitHub tab, or leaving it, is what clears its attention dot. */
	githubScopeKey: string
	hasArtifacts: boolean
	hasTips: boolean
	hasTodos: boolean
	hasWorkspace: boolean
	scratchPadEnabled: boolean
	activeTab: SidebarTab
	setActiveTab: (tab: SidebarTab) => void
	model: TaskDiffReviewModel | null
	isCollapsed: () => boolean
	isModalOpen: boolean
	onCollapse: () => void
	onExpand: () => void
}

function useSessionDiffSidebar({
	hasDiffReview,
	hasGithub,
	githubScopeKey,
	hasArtifacts,
	hasTips,
	hasTodos,
	hasWorkspace,
	scratchPadEnabled,
	activeTab,
	setActiveTab,
	model,
	isCollapsed,
	isModalOpen,
	onCollapse,
	onExpand,
}: SessionDiffSidebarOptions) {
	const visibleTabs = useMemo(
		() =>
			getVisibleSidebarTabs({
				github: hasGithub,
				artifacts: hasArtifacts,
				changes: hasDiffReview,
				diffs: hasDiffReview,
				minimap: true,
				'scratch-pad': scratchPadEnabled,
				workspace: hasWorkspace,
				tips: hasTips,
				todos: hasTodos,
			}),
		[hasArtifacts, hasDiffReview, hasGithub, hasTips, hasTodos, hasWorkspace, scratchPadEnabled],
	)
	const onTabChange = useCallback(
		(nextTab: SidebarTab) => {
			if (nextTab === 'github' || activeTab === 'github') {
				useGitHubPanelStore.getState().clearAttention(githubScopeKey)
			}
			setActiveTab(nextTab)
			if (nextTab === 'diffs') model?.openSidebar()
			else model?.closeSidebar()
		},
		[activeTab, githubScopeKey, model, setActiveTab],
	)
	const onReviewClose = useCallback(() => {
		model?.closeSidebar()
		setActiveTab('changes')
	}, [model, setActiveTab])
	const onOpenPlacement = useCallback(
		(placement: DiffReviewPlacement) => {
			setActiveTab(placement === 'sidebar' ? 'diffs' : 'changes')
		},
		[setActiveTab],
	)
	useEffect(() => {
		if (hasDiffReview || (activeTab !== 'changes' && activeTab !== 'diffs')) return
		model?.closeSidebar()
		setActiveTab('minimap')
	}, [activeTab, hasDiffReview, model, setActiveTab])

	// Cycling works from anywhere on the session page: the artifact panel and its
	// review boundary replace SESSION_DETAIL as the active scope, so register in
	// all three. While a viewer is open, s/⇧S close it instead (useSessionHotkeys),
	// so this registration yields to avoid double-handling the same keypress.
	const selectedArtifactId = useArtifactViewerStore((s) => s.selectedArtifactId)
	const { cycleForward, cycleBackward } = useSidebarCycleHotkeys({
		visibleTabs,
		currentTab: activeTab,
		isCollapsed,
		scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL, HOTKEY_SCOPES.ARTIFACT_V2_PANEL_REVIEW],
		enabled: !isModalOpen && !selectedArtifactId,
		onTabChange,
		onCollapse,
		onExpand,
		onFocusSidebar: focusSidebarPane,
		onFocusMain: focusMainPane,
	})

	return { cycleBackward, cycleForward, onOpenPlacement, onTabChange, onReviewClose }
}

function useSessionMinimap(activeTab: SidebarTab, isModalOpen: boolean) {
	const { conversation, setFocusedEventId, virtualizerRef, visibleEventIndexRef } = useSessionDetail()
	// Tab-gated selector: while another tab is showing, this returns a constant
	// null so j/k in the stream doesn't re-render the sidebar.
	const focusedEventId = useFocusStore((s) => (activeTab === 'minimap' ? s.focusedEventId : null))
	const minimapEvents = useMemo(() => eventsToMinimapEvents(conversation.events), [conversation.events])
	const visibleMinimapEvents = useMemo(() => getVisibleMinimapEvents(minimapEvents), [minimapEvents])
	const focusEvent = useCallback(
		(eventId: string, source: 'keyboard' | 'mouse') => {
			setFocusedEventId(eventId, source)
			const index =
				visibleEventIndexRef.current.get(eventId) ??
				conversation.rootEvents.findIndex((event) => event.id === eventId)
			if (index >= 0) virtualizerRef.current?.scrollToIndex(index, { align: 'center' })
		},
		[conversation.rootEvents, setFocusedEventId, virtualizerRef, visibleEventIndexRef],
	)
	const moveFocus = useCallback(
		(direction: 1 | -1) => {
			if (visibleMinimapEvents.length === 0) return
			const currentIndex = visibleMinimapEvents.findIndex((event) => event.id === focusedEventId)
			const nextIndex =
				currentIndex === -1
					? direction === 1
						? 0
						: visibleMinimapEvents.length - 1
					: Math.max(0, Math.min(currentIndex + direction, visibleMinimapEvents.length - 1))
			const eventId = visibleMinimapEvents[nextIndex]?.id
			if (eventId) focusEvent(eventId, 'keyboard')
		},
		[focusEvent, focusedEventId, visibleMinimapEvents],
	)
	const hotkeyOptions = {
		scopes: [HOTKEY_SCOPES.SESSION_DETAIL],
		area: 'RIGHT_PANE' as const,
		enabled: activeTab === 'minimap' && !isModalOpen,
		preventDefault: true,
	}
	useAppHotkeys('j', () => moveFocus(1), hotkeyOptions)
	useAppHotkeys('k', () => moveFocus(-1), hotkeyOptions)
	const todos = useMemo(
		() => extractTodosFromEvents(conversation.events.filter((event) => !event.parentToolUseId)),
		[conversation.events],
	)
	const onEventClick = useCallback((eventId: string) => focusEvent(eventId, 'mouse'), [focusEvent])

	return {
		focusedEventId,
		minimapEvents,
		todos,
		onEventClick,
	}
}

/**
 * The sidebar widget for the desktop session detail page: minimap, artifacts,
 * tips, and todos tabs, plus the fork selector when fork mode is
 * active. Pulls session state from useSessionDetail() and owns the minimap
 * click handler (focus + scroll-to-event) and the tab-cycle hotkeys.
 */
export function WiredSidebarWidget({ pendingFullscreenArtifactId }: { pendingFullscreenArtifactId?: string }) {
	const sessionDetail = useSessionDetail()
	const { session, conversation, artifactPanel, fork, isModalOpen, hasTaskEditPermission } = sessionDetail
	const artifactHost = deriveSessionArtifactHost({ ...sessionDetail, pendingFullscreenArtifactId })
	const taskDiffReview = useOptionalSessionDiff()
	const { artifactsMetadataCollection, tasksCollection } = useSync()
	const { user } = useAuth()
	const enableCreatingPubliclyShareableLinks = useSettingsStore(
		(s) => s.orgSettings.enableCreatingPubliclyShareableLinks,
	)
	const diffViewerEnabled = useSettingsStore((s) => s.diffViewerEnabled)
	const scratchPadEnabled = useSettingsStore((s) => s.scratchPadEnabled)

	const {
		sessionArtifacts: artifacts,
		sidebarTab,
		handleSidebarTabChange: setSidebarTab,
		handleArtifactClick,
		handleArtifactPanelClose,
		sidebarPanelRef,
		collapseSidebar,
		expandSidebar,
		hasStoredSidebarState,
		pendingScrollCommentId,
		setPendingScrollCommentId,
		isArtifactOwner,
	} = artifactPanel
	const [hasAutoExpandedArtifacts, setHasAutoExpandedArtifacts] = useState(false)

	// Sidebar visibility is controlled by the collapsible ResizablePanel via sidebarPanelRef
	const isSidebarCollapsed = useCallback(() => {
		return sidebarPanelRef.current?.isCollapsed() ?? false
	}, [sidebarPanelRef])

	// Tip preferences
	const [_dismissedTipTypes, setDismissedTipTypes] = useLocalStorage<string[]>(DISMISSED_TIP_TYPES_KEY, [])

	const isRunning = session.status === 'running'
	const taskId = session.task_id
	const { data: taskData } = useLiveQuery(
		(q) => (taskId ? q.from({ tasks: tasksCollection }).where(({ tasks }) => eq(tasks.id, taskId)) : undefined),
		[tasksCollection, taskId],
	)
	const task = taskData?.[0]
	const isProjectWorkspace = task?.workspace_id != null
	const workspaceSetup = useTaskWorkspaceSetup(
		taskId,
		session.host_id,
		task?.workspace_spec?.setupBlocksFirstSession ?? false,
	)
	const workspaceHosts = useMemo(
		() =>
			isProjectWorkspace
				? []
				: deriveWorkspaceHostGroups({
						hosts: workspaceSetup.hosts,
						workspaceSpec: task?.workspace_spec,
						workspaceState: task?.workspace_state,
						currentUserHostId: session.created_by === user?.id ? session.host_id : null,
					}),
		[
			isProjectWorkspace,
			session.created_by,
			session.host_id,
			task?.workspace_spec,
			task?.workspace_state,
			user?.id,
			workspaceSetup.hosts,
		],
	)

	const currentPhase = useMemo(() => getLatestInvokedRpiPhase(conversation.events), [conversation.events])

	// Tips tab is visible only for invoked phases that have written tip content — an RPI skill
	// with no tip (e.g. rpi:design-prd) would otherwise render an empty tab.
	// Dismissal only affects the modal, not the tab.
	const activeTipPhase = hasPhaseTip(currentPhase) ? currentPhase : null

	const minimap = useSessionMinimap(sidebarTab, isModalOpen)

	// Get deleted (tombstoned) artifacts for the trash dropdown
	const { data: deletedDbArtifacts } = useLiveQuery(
		(q) =>
			taskId
				? q
						.from({ artifacts: artifactsMetadataCollection })
						.where(({ artifacts }) => and(eq(artifacts.task_id, taskId), eq(artifacts.is_deleted, true)))
						.select(({ artifacts }) => ({
							id: artifacts.id,
							file_name: artifacts.file_name,
							task_id: artifacts.task_id,
							task_slug: artifacts.task_slug,
							last_updated_at: artifacts.last_updated_at,
							resource_owner_user_id: artifacts.resource_owner_user_id,
							share_key: artifacts.share_key,
							share_enabled: artifacts.share_enabled,
						}))
						.orderBy(({ artifacts }) => artifacts.last_updated_at, 'desc')
				: undefined,
		[artifactsMetadataCollection, taskId],
	)
	const deletedArtifacts = deletedDbArtifacts ?? []

	const hasTodos = minimap.todos.length > 0
	const hasArtifacts = artifacts.length > 0
	const hasTips = activeTipPhase !== null
	const hasWorkspace = isProjectWorkspace || workspaceHosts.length > 0

	const hasGithubTab = useGitHubStatus() !== null
	const hasDiffReview = diffViewerEnabled && Boolean(taskId) && Boolean(taskDiffReview?.files.rows.length)
	const githubScope = useMemo(() => ({ sessionId: session.id }), [session.id])
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
	const handleAutoExpandArtifacts = useCallback(() => {
		expandSidebar()
		setSidebarTab('artifacts')
		setHasAutoExpandedArtifacts(true)
	}, [expandSidebar, setSidebarTab])
	const autoExpandArtifacts =
		!hasStoredSidebarState && !hasAutoExpandedArtifacts && artifacts.length > 0 ? (
			<AutoExpandArtifactsApplier onApply={handleAutoExpandArtifacts} />
		) : null

	// Don't show again callback for tip banner
	const handleTipDontShowAgain = useCallback(() => {
		if (currentPhase) {
			setDismissedTipTypes((prev) => {
				const previousDismissedTipTypes = prev ?? []
				return [...previousDismissedTipTypes, currentPhase]
			})
			// Switch away from tips tab as immediate feedback
			setSidebarTab('minimap')
		}
	}, [currentPhase, setDismissedTipTypes])

	const {
		cycleBackward: cycleSidebarBackward,
		cycleForward: cycleSidebarForward,
		onOpenPlacement: handleOpenDiffPlacement,
		onTabChange: handleSidebarTabChange,
		onReviewClose: handleSidebarReviewClose,
	} = useSessionDiffSidebar({
		hasDiffReview,
		hasGithub: githubTab !== null,
		githubScopeKey,
		hasArtifacts,
		hasTips,
		hasTodos,
		hasWorkspace,
		scratchPadEnabled,
		activeTab: sidebarTab,
		setActiveTab: setSidebarTab,
		model: taskDiffReview,
		isCollapsed: isSidebarCollapsed,
		isModalOpen,
		onCollapse: collapseSidebar,
		onExpand: expandSidebar,
	})

	if (artifactHost.sidebarContent === 'fork') {
		return (
			<>
				{autoExpandArtifacts}
				<ForkSelectorPanel
					events={fork.forkableMessages}
					selectedEventId={fork.selectedForkEventId}
					onSelectEvent={fork.handleForkSelectEvent}
					onCancel={fork.handleForkCancel}
					firstUserMessageId={fork.firstUserMessageId}
					onConfirmSelection={fork.handleForkSelectionConfirm}
				/>
			</>
		)
	}

	return (
		<SidebarWidget
			sessionArtifactPresentation={artifactHost.presentation}
			activeTab={sidebarTab}
			onTabChange={handleSidebarTabChange}
			events={minimap.minimapEvents}
			focusedEventId={minimap.focusedEventId}
			onEventClick={minimap.onEventClick}
			isRunning={isRunning}
			todos={minimap.todos}
			artifacts={artifacts}
			onArtifactClick={handleArtifactClick}
			onArtifactSelect={handleArtifactClick}
			onArtifactClose={handleArtifactPanelClose}
			deletedArtifacts={deletedArtifacts}
			onDeletedArtifactClick={handleArtifactClick}
			workingDirectory={session.working_directory ?? undefined}
			currentUserId={user?.id}
			workspaceState={task?.workspace_state ?? null}
			workspaceHosts={workspaceHosts}
			workspaceContent={isProjectWorkspace && taskId ? <WiredProjectWorkspaceTab taskId={taskId} /> : undefined}
			workspaceSetupContent={(hostId, localPath) =>
				taskId && task && hostId === workspaceSetup.activeHostId ? (
					<WiredWorkspaceSetupStatus
						taskId={taskId}
						taskName={task.name}
						setup={workspaceSetup}
						workspaceSpec={task.workspace_spec}
						hasSession
						localPath={localPath}
					/>
				) : null
			}
			workspaceHostAction={(hostId) =>
				taskId && task && hostId === workspaceSetup.activeHostId ? (
					<WiredWorkspaceSetupStatus
						taskId={taskId}
						taskName={task.name}
						setup={workspaceSetup}
						workspaceSpec={task.workspace_spec}
						renderEditTrigger
					/>
				) : null
			}
			workflowSessions={[]}
			workflowPhases={[]}
			tipPhase={activeTipPhase}
			onTipDontShowAgain={handleTipDontShowAgain}
			taskId={taskId}
			scratchPadStorageKey={`riptide-scratch-pad.${taskId ? `task.${taskId}` : `session.${session.id}`}`}
			scratchPadEnabled={scratchPadEnabled}
			onScratchPadCycleBackward={cycleSidebarBackward}
			onScratchPadCycleForward={cycleSidebarForward}
			hasChangedFiles={Boolean(taskDiffReview?.files.rows.length)}
			githubTab={githubTab}
			pendingScrollCommentId={pendingScrollCommentId}
			onArtifactScrollComplete={() => setPendingScrollCommentId(null)}
			isArtifactOwner={isArtifactOwner}
			canDeleteArtifacts={hasTaskEditPermission}
			hideShareableLinkOption={!enableCreatingPubliclyShareableLinks}
		>
			{autoExpandArtifacts}
			{githubTab && (
				<WiredGitHubTab
					scope={githubScope}
					workspaceRevision={workspaceRevision}
					deliverySessionId={session.id}
				/>
			)}
			{taskDiffReview && (
				<SessionDiffSidebarTabs
					activeTab={sidebarTab}
					model={taskDiffReview}
					sessionId={session.id}
					onOpenPlacement={handleOpenDiffPlacement}
					onReviewClose={handleSidebarReviewClose}
				/>
			)}
		</SidebarWidget>
	)
}

function AutoExpandArtifactsApplier({ onApply }: { onApply: () => void }) {
	useMountEffect(onApply)
	return null
}
