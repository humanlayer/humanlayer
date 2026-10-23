import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@humanlayer/ui/components/tabs'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { Plus } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { LeftSidebarToggleButton } from '@/components/app/LeftSidebarToggleButton'
import { ContextShardsPanel } from '@/components/context-shards/ContextShardsPanel'
import { useHorizontalTabChromeState } from '@/components/horizontal-tabs/HorizontalTabChrome'
import { NewHorizontalTabButton } from '@/components/horizontal-tabs/NewHorizontalTabButton'
import { WiredNotificationBell } from '@/components/notifications/WiredNotificationBell'
import { ActiveSessionsTab } from '@/components/sessions-page/ActiveSessionsTab'
import { DraftsTab } from '@/components/sessions-page/DraftsTab'
import type { SessionsRouteTab, SessionsRouteTo } from '@/components/sessions-page/sessionsRoute'
import { TasksTab } from '@/components/sessions-page/TasksTab'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useActiveSessionsCount } from '@/hooks/live-queries/useActiveSessionsCount'
import { useDraftSessionsCount } from '@/hooks/live-queries/useDraftSessionsCount'
import { useDraftTasksCount } from '@/hooks/live-queries/useDraftTasksCount'
import { useFilteredTasksCount } from '@/hooks/live-queries/useFilteredTasksCount'
import { useCommandPaletteStore } from '@/hooks/stores/commandPaletteStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useSidebarStore } from '@/hooks/stores/sidebarStore'
import { useTaskViewPreferencesStore } from '@/hooks/stores/taskViewPreferencesStore'
import { useSessionsPageHotkeys } from '@/hooks/useSessionsPageHotkeys'
import type { TaskScope } from '@/lib/tasks/taskScope'
import { hasMacWindowControls } from '@/lib/tauri-chrome'
import { cn } from '@/lib/utils'
import { useRiptideApi } from '@/orpc/client'

export type SessionsTab = 'tasks' | 'sessions' | 'drafts' | 'context-shards'

type SessionsPageNavProps = {
	activeTab: SessionsTab
	onTabChange: (tab: SessionsTab) => void
	activeTasksCount: number
	activeSessionCount: number
	draftSessionCount: number
	contextShardCount: number
}

const sessionsNavItems = [
	{ value: 'tasks', label: 'Tasks', countKey: 'activeTasksCount' },
	{ value: 'sessions', label: 'Sessions', countKey: 'activeSessionCount' },
	{ value: 'drafts', label: 'Drafts', countKey: 'draftSessionCount' },
	{ value: 'context-shards', label: 'Context Shards', countKey: 'contextShardCount' },
] as const satisfies ReadonlyArray<{
	value: SessionsTab
	label: string
	countKey?: keyof Pick<
		SessionsPageNavProps,
		'activeTasksCount' | 'activeSessionCount' | 'draftSessionCount' | 'contextShardCount'
	>
}>

/**
 * While the sidebar is collapsed, its toggle and Create Task controls move into
 * the sessions header. While open, both controls stay in the sidebar header.
 */
function SidebarHeaderActions({
	sidebarCollapsed,
	onToggleSidebar,
	onCreateTask,
}: {
	sidebarCollapsed: boolean
	onToggleSidebar: () => void
	onCreateTask: () => void
}) {
	if (!sidebarCollapsed) return null

	return (
		<div className="flex items-center gap-2">
			<LeftSidebarToggleButton sidebarCollapsed={sidebarCollapsed} onToggleSidebar={onToggleSidebar} />

			<Button
				type="button"
				size="sm"
				variant="default"
				onClick={onCreateTask}
				title="Create Task"
				aria-label="Create Task"
			>
				<Plus className="size-4" />
				<span>Create Task</span>
				<KeyboardShortcut size="xs">T</KeyboardShortcut>
			</Button>
		</div>
	)
}

function SessionsTabsNav({ activeTab: _activeTab, ...counts }: SessionsPageNavProps) {
	return (
		<TabsList variant="underline" className="h-full">
			{sessionsNavItems.map((item) => {
				const count = 'countKey' in item ? counts[item.countKey] : undefined
				if (item.value === 'context-shards' && count === 0) return null

				return (
					<TabsTrigger key={item.value} value={item.value}>
						{item.label}
						{count !== undefined && count > 0 && <span>({count})</span>}
					</TabsTrigger>
				)
			})}
		</TabsList>
	)
}

/**
 * The desktop sessions list page: tabs nav with live count badges, the
 * page-level hotkeys (tab switching, create, Escape), and the three
 * self-contained tab components. Tab selection lives in the URL.
 */
export function SessionsPage({ tab, routeTo }: { tab: SessionsRouteTab; routeTo: SessionsRouteTo }) {
	const navigate = useNavigate()
	const { queryClient: api } = useRiptideApi()
	const { user, organizationId } = useAuth()
	const contextShardsQuery = useQuery(
		api.contextShards.list.queryOptions({ input: {}, enabled: !!organizationId, refetchInterval: 30_000 }),
	)
	const contextShardCount = contextShardsQuery.data?.data.length ?? 0
	const activeTab: SessionsTab =
		tab === 'sessions' || tab === 'drafts' || (tab === 'context-shards' && contextShardCount > 0) ? tab : 'tasks'

	// Counts for tab badges
	const activeSessionCount = useActiveSessionsCount(user?.id)
	const draftSessionCount = useDraftSessionsCount(user?.id)
	const draftTasksCount = useDraftTasksCount(user?.id)

	// The Tasks badge repeats the scope predicate the mounted layout applies, so
	// it stays correct while the Tasks body is unmounted.
	const taskViewMode = useTaskViewPreferencesStore((s) => s.mode)
	const selectedUserIds = useTaskViewPreferencesStore((s) => s.selectedUserIds)
	const taskScope = useMemo<TaskScope>(
		() => ({ mode: taskViewMode, selectedUserIds, currentUserId: user?.id ?? null }),
		[taskViewMode, selectedUserIds, user?.id],
	)
	const activeTasksCount = useFilteredTasksCount(taskScope)

	// Combined count for drafts tab badge (task drafts + session drafts)
	const totalDraftsCount = draftTasksCount + draftSessionCount

	const editingSessionId = useFocusStore((s) => s.editingSessionId)
	const isCommandPaletteOpen = useCommandPaletteStore((state) => state.isOpen)
	const sidebarCollapsed = useSidebarStore((state) => state.sidebarCollapsed)
	const setSidebarCollapsed = useSidebarStore((state) => state.setSidebarCollapsed)
	const { ownsHorizontalChrome } = useHorizontalTabChromeState()

	const handleCreateTask = useCallback(() => {
		navigate({ to: '/tasks/new' })
	}, [navigate])
	const handleToggleSidebar = useCallback(
		() => setSidebarCollapsed(!sidebarCollapsed),
		[setSidebarCollapsed, sidebarCollapsed],
	)

	// Reset focus and editing when the tab changes
	const handleTabChange = useCallback(
		(tab: SessionsTab) => {
			const focusStore = useFocusStore.getState()
			focusStore.setFocusedSessionId(null, 'keyboard')
			focusStore.setFocusedTaskId(null, 'keyboard')
			focusStore.setFocusedTaskDraftId(null, 'keyboard')
			focusStore.setEditingSessionId(null)
			navigate({ to: routeTo, search: { tab } })
		},
		[navigate, routeTo],
	)

	useSessionsPageHotkeys({
		scope: HOTKEY_SCOPES.SESSIONS_LIST,
		enabled: true,
		isEditing: editingSessionId !== null,
		isCommandPaletteOpen,
		activeTab,
		showContextShards: contextShardCount > 0,
		onTabChange: handleTabChange,
		onCreateSession: useCallback(() => {
			navigate({ to: '/sessions/draft' })
		}, [navigate]),
		onCreateTask: handleCreateTask,
	})

	// Escape - Blur focused element or clear focus (don't navigate back from root)
	useHotkeys(
		'Escape',
		() => {
			const {
				focusedTaskId,
				focusedTaskDraftId,
				focusedSessionId,
				setFocusedTaskId,
				setFocusedTaskDraftId,
				setFocusedSessionId,
			} = useFocusStore.getState()
			if (focusedTaskId) {
				setFocusedTaskId(null, 'keyboard')
				return
			}
			if (focusedTaskDraftId) {
				setFocusedTaskDraftId(null, 'keyboard')
				return
			}
			if (focusedSessionId) {
				setFocusedSessionId(null, 'keyboard')
				return
			}

			const activeEl = document.activeElement
			const isBodyOrNull = !activeEl || activeEl === document.body

			if (!isBodyOrNull && activeEl instanceof HTMLElement) {
				// Something is focused - blur it
				activeEl.blur()
			} else if (activeTab !== 'tasks') {
				// Navigate back to the logical root task view
				navigate({ to: routeTo })
			}
			// If already on Tasks, do nothing
		},
		{ scopes: [HOTKEY_SCOPES.SESSIONS_LIST], enabled: true },
		[activeTab, navigate, routeTo],
	)

	return (
		// No border-l: the expanded sidebar draws its own border-r, and with the
		// sidebar collapsed a page-edge border would cut through the macOS
		// traffic lights in the desktop app.
		<div className="flex flex-col h-full">
			<Tabs
				value={activeTab}
				onValueChange={(value) => handleTabChange(value as SessionsTab)}
				className="flex flex-col h-full gap-0!"
			>
				{/* Header with the sidebar toggle, tabs, and create button. On the
				sessions root there is no breadcrumb row above, so in the desktop app
				this is the top of the window and acts as the titlebar drag region.
				The traffic lights only float over this row once the sidebar is
				collapsed — while it is open they sit over the sidebar's own header —
				so the inset applies to the collapsed state alone. */}
				<div data-tauri-drag-region className="border-b h-12">
					<div
						data-tauri-drag-region
						className={cn(
							'flex h-full items-center gap-4',
							hasMacWindowControls() && sidebarCollapsed && !ownsHorizontalChrome && 'ml-16',
						)}
					>
						<SidebarHeaderActions
							sidebarCollapsed={sidebarCollapsed}
							onToggleSidebar={handleToggleSidebar}
							onCreateTask={handleCreateTask}
						/>
						<SessionsTabsNav
							activeTab={activeTab}
							onTabChange={handleTabChange}
							activeTasksCount={activeTasksCount}
							activeSessionCount={activeSessionCount}
							draftSessionCount={totalDraftsCount}
							contextShardCount={contextShardCount}
						/>
						<NewHorizontalTabButton className="ml-auto mr-2" />
						<WiredNotificationBell placement="page" className="mr-2" />
					</div>
				</div>

				{/* Tab content - each tab owns its data, actions, and hotkeys */}
				<TabsContent value="tasks" className="flex-1 mt-0 min-h-0 overflow-hidden">
					<TasksTab />
				</TabsContent>

				<TabsContent value="sessions" className="flex-1 mt-0 overflow-y-auto min-h-0">
					<ActiveSessionsTab />
				</TabsContent>

				<TabsContent value="drafts" className="flex-1 mt-0 overflow-y-auto min-h-0">
					<DraftsTab />
				</TabsContent>

				<TabsContent value="context-shards" className="flex-1 mt-0 min-h-0 overflow-hidden">
					<ContextShardsPanel />
				</TabsContent>
			</Tabs>
		</div>
	)
}
