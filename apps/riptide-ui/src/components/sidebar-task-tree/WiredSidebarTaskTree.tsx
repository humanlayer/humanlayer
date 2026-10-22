import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { SidebarFooterBar } from '@humanlayer/ui/components/sidebar/SidebarFooterBar'
import { SidebarHeaderBar } from '@humanlayer/ui/components/sidebar/SidebarHeaderBar'
import { SidebarScrollArea } from '@humanlayer/ui/components/sidebar/SidebarScrollArea'
import { SidebarSectionHeader } from '@humanlayer/ui/components/sidebar/SidebarSectionHeader'
import { SidebarShell } from '@humanlayer/ui/components/sidebar/SidebarShell'
import { Switch } from '@humanlayer/ui/components/switch'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useRef } from 'react'

import { LeftSidebarToggleButton } from '@/components/app/LeftSidebarToggleButton'
import { useHorizontalTabChromeState } from '@/components/horizontal-tabs/HorizontalTabChrome'
import { focusMainAndReleaseSpatialDomFocus } from '@/components/keyboard-focus-transfer'
import { useProjectOnboardingState } from '@/components/onboarding/CreateFirstProjectStep'
import { getOnboardingProgress } from '@/components/onboarding/onboarding-progress'
import { SidebarOnboarding } from '@/components/onboarding/SidebarOnboarding'
import { useGitHubOnboardingProgress } from '@/components/onboarding/useGitHubOnboardingProgress'
import { useDraftSessionsCount } from '@/hooks/live-queries/useDraftSessionsCount'
import { useDraftTasksCount } from '@/hooks/live-queries/useDraftTasksCount'
import { useAgentConnectionsStore } from '@/hooks/stores/agentConnectionsStore'
import { useCommandPaletteStore } from '@/hooks/stores/commandPaletteStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useSidebarStore } from '@/hooks/stores/sidebarStore'
import { useArchiveSessionAction, useArchiveTaskAction } from '@/hooks/useArchiveActions'
import { useLeftNavHotkeys } from '@/hooks/useLeftNavHotkeys'
import { useUserInfo } from '@/hooks/useUserInfo'
import { hasMacWindowControls } from '@/lib/tauri-chrome'
import { isDesktop } from '@/lib/utils'
import { useRiptideApi } from '@/orpc/client'

import { useSidebarNavigation } from './useSidebarNavigation'
import { WiredSessionRow } from './WiredSessionRow'
import { WiredTaskRow } from './WiredTaskRow'

const LOADING_ROW_KEYS = ['task-row-1', 'task-row-2', 'task-row-3', 'task-row-4', 'task-row-5']

export function WiredSidebarTaskTree() {
	const navigate = useNavigate()
	const { queryClient: api } = useRiptideApi()
	const sidebarContainerRef = useRef<HTMLDivElement>(null)
	const {
		tasks,
		standaloneSessions,
		isLoading,
		isReady,
		effectiveExpandedTaskIds,
		routeSessionId,
		navigableItems,
		focusNext,
		focusPrev,
		jumpFirst,
		jumpLast,
	} = useSidebarNavigation(sidebarContainerRef)
	const { userId, dbOrganizationId } = useUserInfo()
	const draftTaskCount = useDraftTasksCount(userId)
	const draftSessionCount = useDraftSessionsCount(userId)
	const totalDraftCount = draftTaskCount + draftSessionCount
	const isSidebarFocused = useFocusStore((state) => state.focusedArea === 'LEFT_NAV')
	// Same treatment as the right sidebar: faint foreground tint (theme-reliable,
	// unlike accent) as base, stronger when focused.
	const backgroundClass = isSidebarFocused ? 'bg-foreground/6' : 'bg-foreground/3'
	const showTaskPhaseLabels = useSettingsStore((state) => state.showTaskPhaseLabels)
	const setShowTaskPhaseLabels = useSettingsStore((state) => state.setShowTaskPhaseLabels)
	const markMutationInFlight = useSettingsStore((state) => state.markMutationInFlight)
	const firstTaskCompletedAt = useSettingsStore((state) => state.firstTaskCompletedAt)
	const onboardingDismissedAt = useSettingsStore((state) => state.onboardingDismissedAt)
	const firstStructuredWorkflowCompletedAt = useSettingsStore((state) => state.firstStructuredWorkflowCompletedAt)
	const firstInboundCommentReceivedAt = useSettingsStore((state) => state.firstInboundCommentReceivedAt)
	const requestedSettingsScope = useSettingsStore((state) => state._serverSettingsRequestedScope)
	const appliedSettingsScope = useSettingsStore((state) => state._serverSettingsAppliedScope)
	const codingAgentReady = useAgentConnectionsStore((state) =>
		state.agentConnections.some((connection) => connection.status === 'ready'),
	)
	const projectOnboarding = useProjectOnboardingState()
	const openCommandPalette = useCommandPaletteStore((state) => state.open)
	const archiveTask = useArchiveTaskAction()
	const archiveSession = useArchiveSessionAction()
	const toggleSidebar = useSidebarStore((state) => state.toggleSidebar)
	const { ownsHorizontalChrome } = useHorizontalTabChromeState()

	const handleCreateTask = useCallback(() => navigate({ to: '/tasks/new' }), [navigate])
	// Onboarding actions open Launcher V3 with the matching workflow selected.
	const handleCreateFirstTask = useCallback(
		(projectId?: string) => navigate({ to: '/tasks/new', search: { workflow: 'freeform', projectId } }),
		[navigate],
	)
	const handleCreateWorkflowTask = useCallback(
		(projectId?: string) =>
			navigate({ to: '/tasks/new', search: { workflow: 'outline_only', showWorkflow: true, projectId } }),
		[navigate],
	)

	const handleExpand = useCallback(() => {
		const item = useFocusStore.getState().focusedSidebarItem
		if (!item) return
		const taskId = item.type === 'task' ? item.id : item.type === 'session' ? item.taskId : null
		if (taskId) useSidebarStore.getState().expandTask(taskId)
	}, [])

	const handleCollapse = useCallback(() => {
		const item = useFocusStore.getState().focusedSidebarItem
		if (!item) return
		const taskId = item.type === 'task' ? item.id : item.type === 'session' ? item.taskId : null
		if (!taskId) return

		if (effectiveExpandedTaskIds.includes(taskId)) {
			useSidebarStore.getState().collapseTask(taskId)
			if (item.type === 'session') useFocusStore.getState().setFocusedSidebarItem({ type: 'task', id: taskId })
		} else {
			useSidebarStore.getState().expandTask(taskId)
		}
	}, [effectiveExpandedTaskIds])

	const handleSelectFocused = useCallback(() => {
		const item = useFocusStore.getState().focusedSidebarItem
		if (!item) return
		if (item.type === 'task') navigate({ to: '/tasks/$taskId', params: { taskId: item.id } })
		else navigate({ to: '/sessions/$sessionId', params: { sessionId: item.id } })
		focusMainAndReleaseSpatialDomFocus()
	}, [navigate])

	const handleArchiveFocused = useCallback(() => {
		const item = useFocusStore.getState().focusedSidebarItem
		if (!item) return

		let archived = false
		if (item.type === 'task') {
			const task = tasks.find((candidate) => candidate.id === item.id)
			if (task) {
				archived = archiveTask({
					id: task.id,
					name: task.name,
					ownerUserId: task.ownerUserId,
					sessionIds: task.sessions.map((session) => session.id),
				})
			}
		} else {
			const parentTask = item.type === 'session' ? tasks.find((task) => task.id === item.taskId) : undefined
			const session =
				parentTask?.sessions.find((candidate) => candidate.id === item.id) ??
				standaloneSessions.find((candidate) => candidate.id === item.id)
			if (session) {
				archived = archiveSession({ id: session.id, name: session.name, ownerUserId: session.ownerUserId })
				if (archived && routeSessionId === session.id) {
					if (parentTask) navigate({ to: '/tasks/$taskId', params: { taskId: parentTask.id } })
					else navigate({ to: '/sessions' })
				}
			}
		}

		if (!archived) return
		if (item.type === 'task') {
			useFocusStore.getState().focusAfterSidebarTaskRemoved(navigableItems, item.id)
			return
		}
		const currentIndex = navigableItems.findIndex(
			(candidate) => candidate.id === item.id && candidate.type === item.type,
		)
		const nextItem = navigableItems[currentIndex + 1] ?? navigableItems[currentIndex - 1]
		useFocusStore.getState().setFocusedSidebarItem(nextItem ?? null)
	}, [archiveSession, archiveTask, navigate, navigableItems, routeSessionId, standaloneSessions, tasks])

	useLeftNavHotkeys({
		enabled: isSidebarFocused,
		onFocusNext: focusNext,
		onFocusPrev: focusPrev,
		onSelect: handleSelectFocused,
		onJumpFirst: jumpFirst,
		onJumpLast: jumpLast,
		onExpand: handleExpand,
		onCollapse: handleCollapse,
		onArchive: handleArchiveFocused,
	})

	const updateSettingsMutation = useMutation(
		api.auth.user.settings.update.mutationOptions({
			onSuccess: (data) => {
				useSettingsStore.setState({ _lastMutationAt: 0 })
				useSettingsStore.getState().applyServerSettings(data)
			},
			onError: () => useSettingsStore.setState({ _lastMutationAt: 0 }),
		}),
	)
	const handleTaskPhaseLabelsChange = (checked: boolean) => {
		setShowTaskPhaseLabels(checked)
		markMutationInFlight()
		updateSettingsMutation.mutate({ showTaskPhaseLabels: checked })
	}
	const onboardingDismissedForCurrentScope =
		requestedSettingsScope !== null &&
		requestedSettingsScope === appliedSettingsScope &&
		onboardingDismissedAt !== null
	const showSidebarOnboarding = isDesktop()
	const githubOnboarding = useGitHubOnboardingProgress()
	const baseOnboardingRemaining = getOnboardingProgress({
		deviceSetupOnly: false,
		hasReadyAgent: codingAgentReady,
		firstTaskCompletedAt,
		firstStructuredWorkflowCompletedAt,
		collaboration:
			requestedSettingsScope === null || requestedSettingsScope !== appliedSettingsScope
				? 'pending'
				: firstInboundCommentReceivedAt === null
					? 'incomplete'
					: 'complete',
		github: githubOnboarding,
	}).remaining
	const onboardingRemaining =
		baseOnboardingRemaining + (projectOnboarding.enabled && !projectOnboarding.hasUsableProject ? 1 : 0)
	const onboardingContent =
		showSidebarOnboarding && !onboardingDismissedForCurrentScope ? (
			<SidebarOnboarding
				key={`${userId ?? 'unknown'}:${dbOrganizationId ?? 'unknown'}`}
				onCreateTask={handleCreateFirstTask}
				onCreateWorkflowTask={handleCreateWorkflowTask}
			/>
		) : null

	const header = (
		<SidebarHeaderBar
			onOpenCommandPalette={openCommandPalette}
			onCreateTask={handleCreateTask}
			leadingAction={
				<div className={hasMacWindowControls() && !ownsHorizontalChrome ? 'ml-16' : undefined}>
					<LeftSidebarToggleButton sidebarCollapsed={false} onToggleSidebar={toggleSidebar} />
				</div>
			}
		/>
	)
	const footer = (
		<>
			<SidebarFooterBar>
				<label
					htmlFor="sidebar-phase-labels-switch"
					className="flex items-center gap-2 uppercase tracking-wide"
				>
					<Switch
						id="sidebar-phase-labels-switch"
						checked={showTaskPhaseLabels}
						onCheckedChange={handleTaskPhaseLabelsChange}
					/>
					<span>Labels</span>
				</label>
				<span className="ml-auto flex items-center gap-1">
					<KeyboardShortcut size="xs">⌘+B</KeyboardShortcut>
					<span>toggle</span>
				</span>
			</SidebarFooterBar>
		</>
	)

	if (isLoading) {
		return (
			<SidebarShell className={backgroundClass}>
				{header}
				<SidebarScrollArea>
					{onboardingContent}
					<div className="space-y-3 p-3">
						<div className="text-xs font-medium uppercase tracking-wide text-sidebar-foreground/50">
							Loading tasks
						</div>
						<div className="space-y-2">
							{LOADING_ROW_KEYS.map((rowKey) => (
								<div key={rowKey} className="grid grid-cols-[1fr_2.25rem] items-center gap-2 py-1.5">
									<div className="h-3 animate-pulse bg-sidebar-accent" />
									<div className="h-3 animate-pulse bg-sidebar-accent" />
								</div>
							))}
						</div>
					</div>
				</SidebarScrollArea>
				{footer}
			</SidebarShell>
		)
	}

	if (isReady && tasks.length === 0 && standaloneSessions.length === 0 && totalDraftCount === 0) {
		return (
			<SidebarShell className={backgroundClass}>
				{header}
				<SidebarScrollArea>
					{onboardingContent}
					<div className={showSidebarOnboarding && onboardingRemaining > 0 ? 'sr-only' : 'space-y-3 p-3'}>
						<div className="text-xs font-medium uppercase tracking-wide text-sidebar-foreground/50">
							No sidebar tasks
						</div>
						<div className="rounded-md border border-dashed border-sidebar-border p-3 text-xs text-sidebar-foreground/60">
							No active tasks or sessions found. Create a task to populate this sidebar.
						</div>
					</div>
				</SidebarScrollArea>
				{footer}
			</SidebarShell>
		)
	}

	const flatContent = (
		<>
			{totalDraftCount > 0 ? (
				<SidebarSectionHeader
					icon="drafts"
					label="Drafts"
					count={totalDraftCount}
					onClick={() => navigate({ to: '/sessions', search: { tab: 'drafts' } })}
				/>
			) : null}
			{totalDraftCount > 0 || (tasks.length > 0 && standaloneSessions.length > 0) ? (
				<SidebarSectionHeader icon="tasks" label="Tasks" count={tasks.length || undefined} />
			) : null}
			{tasks.length > 0 ? (
				<ul className="flex flex-col py-1">
					{tasks.map((task) => (
						<WiredTaskRow key={task.id} task={task} />
					))}
				</ul>
			) : null}
			{standaloneSessions.length > 0 ? (
				<div className={tasks.length > 0 || totalDraftCount > 0 ? 'mt-4' : undefined}>
					<SidebarSectionHeader
						icon="standalone"
						label="Standalone Sessions"
						count={standaloneSessions.length}
					/>
					<ul className="flex flex-col">
						{standaloneSessions.map((session) => (
							<WiredSessionRow key={session.id} session={session} />
						))}
					</ul>
				</div>
			) : null}
		</>
	)

	return (
		<div ref={sidebarContainerRef} className="h-full">
			<SidebarShell className={backgroundClass}>
				{header}
				<SidebarScrollArea>
					{onboardingContent}
					{flatContent}
				</SidebarScrollArea>
				{footer}
			</SidebarShell>
		</div>
	)
}
