import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { SidebarFooterBar } from '@humanlayer/ui/components/sidebar/SidebarFooterBar'
import { SidebarHeaderBar } from '@humanlayer/ui/components/sidebar/SidebarHeaderBar'
import { SidebarScrollArea } from '@humanlayer/ui/components/sidebar/SidebarScrollArea'
import { SidebarSectionHeader } from '@humanlayer/ui/components/sidebar/SidebarSectionHeader'
import { SidebarShell } from '@humanlayer/ui/components/sidebar/SidebarShell'
import type { SidebarSession } from '@humanlayer/ui/components/sidebar/types'
import { Switch } from '@humanlayer/ui/components/switch'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useCallback, useRef, useState } from 'react'

import { LeftSidebarToggleButton } from '@/components/app/LeftSidebarToggleButton'
import { useHorizontalTabChromeState } from '@/components/horizontal-tabs/HorizontalTabChrome'
import { focusMainAndReleaseSpatialDomFocus } from '@/components/keyboard-focus-transfer'
import { SidebarOnboarding } from '@/components/onboarding/SidebarOnboarding'
import { useDraftSessionsCount } from '@/hooks/live-queries/useDraftSessionsCount'
import { useDraftTasksCount } from '@/hooks/live-queries/useDraftTasksCount'
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

import type { ProjectSidebarTask } from './derive-project-sidebar'
import { useProjectTaskDisclosure } from './project-task-disclosure'
import { ProjectSidebarFocusSync } from './ProjectSidebarFocusSync'
import { useProjectSidebarNavigation } from './useProjectSidebarNavigation'

export function ProjectSidebarFrame({
	tasks,
	standaloneSessions,
	children,
}: {
	tasks: ProjectSidebarTask[]
	standaloneSessions: SidebarSession[]
	children: ReactNode
}) {
	const navigate = useNavigate()
	const { queryClient: api } = useRiptideApi()
	const sidebarContainerRef = useRef<HTMLDivElement>(null)
	const [controlFocused, setControlFocused] = useState(false)
	const {
		tasks: visibleTasks,
		effectiveExpandedTaskIds,
		routeSessionId,
		navigableItems,
		focusNext,
		focusPrev,
		jumpFirst,
		jumpLast,
	} = useProjectSidebarNavigation(sidebarContainerRef, tasks, standaloneSessions)
	const { userId } = useUserInfo()
	const draftTaskCount = useDraftTasksCount(userId)
	const draftSessionCount = useDraftSessionsCount(userId)
	const totalDraftCount = draftTaskCount + draftSessionCount
	const isSidebarFocused = useFocusStore((state) => state.focusedArea === 'LEFT_NAV')
	// Pointer focus enters LEFT_NAV before selection returns to MAIN. Keep the
	// surface stable through that round trip; individual rows convey focus.
	const backgroundClass = 'bg-foreground/3'
	const showTaskPhaseLabels = useSettingsStore((state) => state.showTaskPhaseLabels)
	const setShowTaskPhaseLabels = useSettingsStore((state) => state.setShowTaskPhaseLabels)
	const markMutationInFlight = useSettingsStore((state) => state.markMutationInFlight)
	const firstTaskCompletedAt = useSettingsStore((state) => state.firstTaskCompletedAt)
	const onboardingDismissedAt = useSettingsStore((state) => state.onboardingDismissedAt)
	const firstStructuredWorkflowCompletedAt = useSettingsStore((state) => state.firstStructuredWorkflowCompletedAt)
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
		if (taskId) useProjectTaskDisclosure.getState().setOpen(taskId, true)
	}, [])

	const handleCollapse = useCallback(() => {
		const item = useFocusStore.getState().focusedSidebarItem
		if (!item) return
		const taskId = item.type === 'task' ? item.id : item.type === 'session' ? item.taskId : null
		if (!taskId) return

		if (effectiveExpandedTaskIds.includes(taskId)) {
			useProjectTaskDisclosure.getState().setOpen(taskId, false)
			if (item.type === 'session') useFocusStore.getState().setFocusedSidebarItem({ type: 'task', id: taskId })
		} else {
			useProjectTaskDisclosure.getState().setOpen(taskId, true)
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
					sessionIds: task.allSessionIds,
				})
			}
		} else {
			const parentTask =
				item.type === 'session' ? visibleTasks.find((task) => task.id === item.taskId) : undefined
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
	}, [archiveSession, archiveTask, navigate, navigableItems, routeSessionId, standaloneSessions, tasks, visibleTasks])

	useLeftNavHotkeys({
		// Native buttons (including reorder controls) own Enter/Space while tab-focused.
		enabled: isSidebarFocused && !controlFocused,
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
	const showSidebarOnboarding =
		isDesktop() &&
		onboardingDismissedAt === null &&
		(firstTaskCompletedAt === null || firstStructuredWorkflowCompletedAt === null)
	const onboardingContent = showSidebarOnboarding ? (
		<SidebarOnboarding onCreateTask={handleCreateFirstTask} onCreateWorkflowTask={handleCreateWorkflowTask} />
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
		<SidebarFooterBar>
			<Switch
				id="project-sidebar-labels"
				checked={showTaskPhaseLabels}
				onCheckedChange={handleTaskPhaseLabelsChange}
			/>
			<label htmlFor="project-sidebar-labels" className="uppercase tracking-wide">
				Labels
			</label>
			<span className="ml-auto flex items-center gap-1">
				<KeyboardShortcut size="xs">⌘+B</KeyboardShortcut>
				<span>toggle</span>
			</span>
		</SidebarFooterBar>
	)

	return (
		<div
			ref={sidebarContainerRef}
			className="h-full"
			onFocusCapture={(event) =>
				setControlFocused(
					event.target instanceof HTMLElement && event.target.closest('button, a, [role="switch"]') !== null,
				)
			}
			onBlurCapture={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) setControlFocused(false)
			}}
		>
			<ProjectSidebarFocusSync key={JSON.stringify(navigableItems)} items={navigableItems} />
			<SidebarShell className={backgroundClass}>
				{header}
				<SidebarScrollArea>
					{onboardingContent}
					{totalDraftCount > 0 ? (
						<SidebarSectionHeader
							icon="drafts"
							label="Drafts"
							count={totalDraftCount}
							onClick={() => navigate({ to: '/sessions', search: { tab: 'drafts' } })}
						/>
					) : null}
					{children}
				</SidebarScrollArea>
				{footer}
			</SidebarShell>
		</div>
	)
}
