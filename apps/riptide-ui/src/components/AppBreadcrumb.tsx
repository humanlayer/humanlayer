import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@humanlayer/ui/components/breadcrumb'
import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { Link, useLocation, useParams, useSearch } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { Check, Link as LinkIcon, Pencil, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { createSessionActions } from '@/actions/sessions'
import { LeftSidebarToggleButton } from '@/components/app/LeftSidebarToggleButton'
import { useHorizontalTabChromeState } from '@/components/horizontal-tabs/HorizontalTabChrome'
import { NewHorizontalTabButton } from '@/components/horizontal-tabs/NewHorizontalTabButton'
import { WiredNotificationBell } from '@/components/notifications/WiredNotificationBell'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { SettingsBreadcrumb } from '@/components/settings/SettingsBreadcrumb'
import { RightSidebarToggleButton } from '@/components/sidebar-widget/RightSidebarToggleButton'
import { WiredSessionHostControl } from '@/components/WiredSessionHostControl'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useSidebarStore } from '@/hooks/stores/sidebarStore'
import { useSessionPermissions } from '@/hooks/useSessionPermissions'
import { useTaskPermissions } from '@/hooks/useTaskPermissions'
import { useUserInfo } from '@/hooks/useUserInfo'
import { formatShortcut, hotkeysCatalog } from '@/hotkeysCatalog'
import { hasMacWindowControls } from '@/lib/tauri-chrome'
import { cn } from '@/lib/utils'
import { useRiptideApi } from '@/orpc/client'
import { copySessionDeepLink } from '@/utils/sharing-links'

function parseBreadcrumbRoute(pathname: string, taskId: string | undefined) {
	const segments = pathname.split('/').filter(Boolean)
	const isSessionsRoute = segments[0] === 'sessions'
	const isTasksRoute = segments[0] === 'tasks'
	const isDraft = isSessionsRoute && segments[1] === 'draft'
	const isNewTask = isTasksRoute && segments[1] === 'new'
	const isTaskDetail = isTasksRoute && taskId
	const isArchiveRoute = segments[0] === 'archive'
	const isArchiveTasks = isArchiveRoute && segments[1] === 'tasks'
	const isArchiveSessions = isArchiveRoute && segments[1] === 'sessions'
	const isSessionsRoot = segments.length === 0 || (isSessionsRoute && segments.length === 1)
	const isSettingsRoute = segments[0] === 'settings'

	return {
		isSessionsRoute,
		isDraft,
		isNewTask,
		isTaskDetail,
		isArchiveTasks,
		isArchiveSessions,
		isSessionsRoot,
		isSettingsRoute,
	}
}

function useAppBreadcrumbState() {
	const location = useLocation()
	const params = useParams({ strict: false })
	const search = useSearch({ strict: false })
	const fromParam = search.from

	const {
		sessionsCollection,
		tasksCollection,
		eventsCollection,
		taskOrganizationAclsCollection,
		taskUserAclsCollection,
	} = useSync()
	const { confirmTx } = useSyncInternal()
	const { client } = useRiptideApi()
	const { user } = useAuth()
	const { dbOrganizationId, userId: dbUserId } = useUserInfo()

	const sessionId = params.sessionId as string | undefined
	const taskId = params.taskId as string | undefined
	const {
		isSessionsRoute,
		isDraft,
		isNewTask,
		isTaskDetail,
		isArchiveTasks,
		isArchiveSessions,
		isSessionsRoot,
		isSettingsRoute,
	} = parseBreadcrumbRoute(location.pathname, taskId)

	// Query session data (only when on session detail)
	const sessionQuery = useLiveQuery(
		(q) => {
			if (!sessionId) return undefined
			return q.from({ sessions: sessionsCollection }).where(({ sessions }) => eq(sessions.id, sessionId))
		},
		[sessionsCollection, sessionId],
	)
	const session = sessionQuery.data?.[0]

	// Compute task-level edit access for session permission check
	const taskForPermissionCheck = useMemo(
		() =>
			session?.task_id
				? { id: session.task_id, resource_owner_user_id: session.resource_owner_user_id }
				: undefined,
		[session?.task_id, session?.resource_owner_user_id],
	)
	const { effectivePermission } = useTaskPermissions(
		taskForPermissionCheck,
		user?.id,
		taskOrganizationAclsCollection,
		taskUserAclsCollection,
	)

	// Permission checks for shared sessions
	const multiplayerPromptingEnabled = useSettingsStore((state) => state.orgSettings.multiplayerPromptingEnabled)
	const { canManageSession } = useSessionPermissions(
		session,
		user?.id,
		effectivePermission,
		multiplayerPromptingEnabled,
	)

	// Query task data (for task detail page)
	const taskQuery = useLiveQuery(
		(q) => {
			if (!taskId) return undefined
			return q.from({ tasks: tasksCollection }).where(({ tasks }) => eq(tasks.id, taskId))
		},
		[tasksCollection, taskId],
	)
	const task = taskQuery.data?.[0]
	const showSidebarWidgetLegend =
		(isSessionsRoute && !!sessionId && !isDraft && !!session) || (!!isTaskDetail && !!task)

	// Resolve the session's linked task even when it is archived or shared.
	const { data: sessionTaskData } = useLiveQuery(
		(q) => {
			if (!session?.task_id) return undefined
			return q.from({ tasks: tasksCollection }).where(({ tasks }) => eq(tasks.id, session.task_id))
		},
		[tasksCollection, session?.task_id],
	)
	const sessionTask = sessionTaskData?.[0] ?? null

	// Inline editing state (for session title)
	const [isEditing, setIsEditing] = useState(false)
	const [editValue, setEditValue] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)

	// Session actions for title update
	const sessionActions = useMemo(
		() =>
			createSessionActions(
				sessionsCollection,
				{
					sessions: {
						update: (input) => client.sessions.update(input),
						continue: (input) => client.sessions.continue(input),
						interrupt: (input) => client.sessions.interrupt(input),
					},
				},
				dbUserId ?? '',
				dbOrganizationId ?? '',
				eventsCollection,
				tasksCollection,
				{
					launch: (input) => client.sessions.launch(input),
					create: (input) => client.sessions.create(input),
					fork: (input) => client.sessions.fork(input),
					handoff: (input) => client.sessions.handoff(input, { context: { silent: true } }),
					createV2: (input) => client.sessions.v2.create(input),
				},
				confirmTx.sessions,
			),
		[sessionsCollection, client, dbUserId, dbOrganizationId, eventsCollection, tasksCollection, confirmTx.sessions],
	)

	const startEdit = useCallback(() => {
		if (session) {
			setEditValue(session.title || '')
			setIsEditing(true)
			setTimeout(() => inputRef.current?.focus(), 0)
		}
	}, [session])

	const saveEdit = useCallback(() => {
		if (!sessionId || !editValue.trim()) {
			setIsEditing(false)
			return
		}
		setIsEditing(false)
		const transaction = sessionActions.updateSessionTitle({ sessionId, title: editValue.trim() })
		transaction.isPersisted.promise
			.then(() => toast.success(`Updated title to: ${editValue.trim()}`))
			.catch(() => toast.error('Failed to update title'))
	}, [sessionId, editValue, sessionActions])

	const cancelEdit = useCallback(() => {
		setIsEditing(false)
		setEditValue('')
	}, [])

	// Shift+R hotkey for rename (only on session detail, not while editing)
	useHotkeys(
		'shift+r',
		(e) => {
			e.preventDefault()
			startEdit()
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: canManageSession && !!sessionId && !isEditing,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[canManageSession, sessionId, isEditing, startEdit],
	)

	// Get display title for session
	const displayTitle = session?.title || (sessionId ? `Session ${sessionId.slice(0, 8)}` : 'Session')

	// In the desktop app this row is the top of the window and doubles as the
	// titlebar drag region. When the sidebar is collapsed it also sits under the
	// macOS traffic lights, so inset the content past them.
	const sidebarCollapsed = useSidebarStore((s) => s.sidebarCollapsed)
	const toggleSidebar = useSidebarStore((s) => s.toggleSidebar)
	const { ownsHorizontalChrome } = useHorizontalTabChromeState()
	const needsWindowControlsInset = hasMacWindowControls() && sidebarCollapsed && !ownsHorizontalChrome

	return {
		location,
		search,
		fromParam,
		isSessionsRoute,
		isDraft,
		sessionId,
		isNewTask,
		isTaskDetail,
		isArchiveTasks,
		isArchiveSessions,
		isSessionsRoot,
		isSettingsRoute,
		task,
		sessionTask,
		showSidebarWidgetLegend,
		isEditing,
		editValue,
		inputRef,
		setEditValue,
		saveEdit,
		cancelEdit,
		displayTitle,
		canManageSession,
		startEdit,
		sidebarCollapsed,
		toggleSidebar,
		needsWindowControlsInset,
	}
}

type BreadcrumbState = ReturnType<typeof useAppBreadcrumbState>

export function AppBreadcrumb({
	rightSidebarOpen = false,
	onToggleRightSidebar,
}: { rightSidebarOpen?: boolean; onToggleRightSidebar?: () => void } = {}) {
	const state = useAppBreadcrumbState()
	const {
		location,
		isSettingsRoute,
		isSessionsRoot,
		needsWindowControlsInset,
		sidebarCollapsed,
		toggleSidebar,
		showSidebarWidgetLegend,
		sessionId,
		isDraft,
	} = state
	if (isSettingsRoute) {
		return <SettingsBreadcrumb pathname={location.pathname} />
	}

	if (isSessionsRoot) return null

	return (
		<Breadcrumb
			data-tauri-drag-region
			className={cn(
				'flex h-9 items-center py-1 font-mono text-sm shrink-0 pr-4 min-w-0 w-full overflow-hidden',
				// When this row hosts the traffic lights (collapsed sidebar), only
				// inset past them. The fixed height prevents the toggle button from
				// making the row taller than the expanded-sidebar breadcrumb row.
				needsWindowControlsInset && 'ml-16',
			)}
		>
			<div
				data-tauri-drag-region
				className="@container flex min-w-0 w-full items-center justify-between gap-6 overflow-hidden"
			>
				{sidebarCollapsed && (
					<LeftSidebarToggleButton sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
				)}
				<BreadcrumbList
					data-tauri-drag-region
					className="min-w-0 flex-1 flex-nowrap overflow-hidden [&_[data-slot=breadcrumb-separator]]:shrink-0"
				>
					<RouteBreadcrumbItems state={state} />
				</BreadcrumbList>
				{/* Host + sidebar toggle live here only while the right sidebar is
				    collapsed; when it's open, the full-height sidebar's header strip
				    hosts them instead. */}
				{showSidebarWidgetLegend && !rightSidebarOpen && (
					<div className="flex min-w-0 shrink-0 items-center gap-2 text-muted-foreground">
						{sessionId && !isDraft && (
							<div className="flex min-w-0 max-w-[clamp(8rem,22vw,20rem)] justify-end text-sm">
								<WiredSessionHostControl sessionId={sessionId} className="max-w-full" />
							</div>
						)}
						{onToggleRightSidebar && (
							<RightSidebarToggleButton sidebarCollapsed onToggleSidebar={onToggleRightSidebar} />
						)}
					</div>
				)}
				<NewHorizontalTabButton className="ml-2" />
				<WiredNotificationBell placement="page" className="ml-1" />
			</div>
		</Breadcrumb>
	)
}

// Dispatch only presentation: the parent retains query, permission and rename hook lifecycles.
function RouteBreadcrumbItems({ state }: { state: BreadcrumbState }) {
	if (state.isArchiveTasks || state.isArchiveSessions) return <ArchiveBreadcrumbItems {...state} />
	if (state.isTaskDetail || state.isNewTask) return <TaskBreadcrumbItems {...state} />
	if (state.isSessionsRoute) return <SessionBreadcrumbItems {...state} />
	return null
}

function ArchiveBreadcrumbItems({ isArchiveTasks }: Pick<BreadcrumbState, 'isArchiveTasks'>) {
	return (
		<>
			<BreadcrumbItem className="shrink-0">
				<BreadcrumbPage>Archive</BreadcrumbPage>
			</BreadcrumbItem>
			<BreadcrumbSeparator />
			<BreadcrumbItem>
				<BreadcrumbPage>{isArchiveTasks ? 'Tasks' : 'Sessions'}</BreadcrumbPage>
			</BreadcrumbItem>
		</>
	)
}

function TaskBreadcrumbItems({
	isTaskDetail,
	task,
	fromParam,
	isNewTask,
}: Pick<BreadcrumbState, 'isTaskDetail' | 'task' | 'fromParam' | 'isNewTask'>) {
	return (
		<>
			{/* TASK DETAIL PAGE: Tasks > TaskName */}
			{isTaskDetail && task && fromParam !== 'archive-tasks' && (
				<>
					<BreadcrumbItem>
						<BreadcrumbLink asChild className="cursor-pointer">
							<Link to="/sessions" search={{ tab: 'tasks' }}>
								Tasks
							</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem className="min-w-0 shrink">
						<Tooltip>
							<TooltipTrigger asChild>
								<BreadcrumbPage className="block min-w-0 max-w-[clamp(10rem,32vw,34rem)] truncate">
									{task.name}
								</BreadcrumbPage>
							</TooltipTrigger>
							<TooltipContent className="max-w-[600px]">{task.name}</TooltipContent>
						</Tooltip>
					</BreadcrumbItem>
				</>
			)}

			{/* TASK DETAIL PAGE (from archive): Archive > Tasks > TaskName */}
			{isTaskDetail && task && fromParam === 'archive-tasks' && (
				<>
					<BreadcrumbItem className="shrink-0">
						<BreadcrumbLink asChild className="cursor-pointer">
							<Link to="/archive/tasks">Archive</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem className="shrink-0">
						<BreadcrumbLink asChild className="cursor-pointer">
							<Link to="/archive/tasks">Tasks</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem className="min-w-0 shrink">
						<Tooltip>
							<TooltipTrigger asChild>
								<BreadcrumbPage className="block min-w-0 max-w-[clamp(10rem,32vw,34rem)] truncate">
									{task.name}
								</BreadcrumbPage>
							</TooltipTrigger>
							<TooltipContent className="max-w-[600px]">{task.name}</TooltipContent>
						</Tooltip>
					</BreadcrumbItem>
				</>
			)}

			{/* NEW TASK PAGE: Tasks > New */}
			{isNewTask && (
				<>
					<BreadcrumbItem className="shrink-0">
						<BreadcrumbLink asChild className="cursor-pointer">
							<Link to="/sessions" search={{ tab: 'tasks' }} tabIndex={-1}>
								Tasks
							</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem className="shrink-0">
						<BreadcrumbPage>New</BreadcrumbPage>
					</BreadcrumbItem>
				</>
			)}
		</>
	)
}

function SessionBreadcrumbItems({
	sessionTask,
	fromParam,
	sessionId,
	isDraft,
	search,
	isEditing,
	inputRef,
	editValue,
	setEditValue,
	saveEdit,
	cancelEdit,
	displayTitle,
	canManageSession,
	startEdit,
}: Pick<
	BreadcrumbState,
	| 'sessionTask'
	| 'fromParam'
	| 'sessionId'
	| 'isDraft'
	| 'search'
	| 'isEditing'
	| 'inputRef'
	| 'editValue'
	| 'setEditValue'
	| 'saveEdit'
	| 'cancelEdit'
	| 'displayTitle'
	| 'canManageSession'
	| 'startEdit'
>) {
	return (
		<>
			{/* Sessions root - show "Archived Sessions" when from archive */}
			{!sessionTask && fromParam === 'archive-sessions' && sessionId && (
				<BreadcrumbItem className="shrink-0">
					<BreadcrumbLink asChild className="cursor-pointer">
						<Link to="/archive/sessions">Archived Sessions</Link>
					</BreadcrumbLink>
				</BreadcrumbItem>
			)}

			{/* Sessions root - only show when NOT in a task context and NOT from archive */}
			{!sessionTask && fromParam !== 'archive-sessions' && (
				<SessionListBreadcrumb tab={sessionId || isDraft ? 'sessions' : search.tab} />
			)}

			{/* Draft */}
			{isDraft && (
				<>
					<BreadcrumbSeparator />
					<BreadcrumbItem className="shrink-0">
						<BreadcrumbPage>Draft</BreadcrumbPage>
					</BreadcrumbItem>
				</>
			)}

			{/* Task context breadcrumb: Tasks > TaskName (when session has task) */}
			{sessionId && !isDraft && sessionTask && (
				<>
					<BreadcrumbItem className="shrink-0">
						<BreadcrumbLink asChild className="cursor-pointer">
							<Link to="/sessions" search={{ tab: 'tasks' }}>
								Tasks
							</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem className="min-w-0 shrink">
						<BreadcrumbLink asChild>
							<Link
								to="/tasks/$taskId"
								params={{ taskId: sessionTask.id }}
								className="block min-w-0 max-w-[clamp(8rem,24vw,24rem)] truncate"
							>
								{sessionTask.name}
							</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
				</>
			)}

			{/* Session Detail with inline editing */}
			{sessionId && !isDraft && (
				<>
					<BreadcrumbSeparator />
					<BreadcrumbItem className="min-w-0 shrink">
						<SessionTitleBreadcrumb
							isEditing={isEditing}
							inputRef={inputRef}
							editValue={editValue}
							setEditValue={setEditValue}
							saveEdit={saveEdit}
							cancelEdit={cancelEdit}
							displayTitle={displayTitle}
							sessionId={sessionId}
							canManageSession={canManageSession}
							startEdit={startEdit}
						/>
					</BreadcrumbItem>
				</>
			)}
		</>
	)
}

function SessionListBreadcrumb({ tab }: { tab: BreadcrumbState['search']['tab'] }) {
	const label = tab === 'sessions' ? 'Sessions' : tab === 'drafts' ? 'Drafts' : 'Tasks'
	return (
		<BreadcrumbItem className="shrink-0">
			<BreadcrumbLink asChild className="cursor-pointer">
				<Link to="/sessions" search={{ tab }}>
					{label}
				</Link>
			</BreadcrumbLink>
		</BreadcrumbItem>
	)
}

function SessionTitleBreadcrumb({
	isEditing,
	inputRef,
	editValue,
	setEditValue,
	saveEdit,
	cancelEdit,
	displayTitle,
	sessionId,
	canManageSession,
	startEdit,
}: Pick<
	BreadcrumbState,
	| 'isEditing'
	| 'inputRef'
	| 'editValue'
	| 'setEditValue'
	| 'saveEdit'
	| 'cancelEdit'
	| 'displayTitle'
	| 'sessionId'
	| 'canManageSession'
	| 'startEdit'
>) {
	if (!sessionId) return null

	const copyLinkShortcut = formatShortcut(hotkeysCatalog.sessionDetail.shortcuts.copyPrimaryUrl.display)

	return (
		<>
			{isEditing ? (
				<div className="flex items-center gap-1">
					<input
						ref={inputRef}
						type="text"
						aria-label="Session name"
						value={editValue}
						onChange={(e) => setEditValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault()
								saveEdit()
							} else if (e.key === 'Escape') {
								e.preventDefault()
								cancelEdit()
							}
						}}
						onBlur={cancelEdit}
						className="px-1 py-0.5 text-sm bg-background border rounded font-mono focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
						style={{
							width: `${Math.max(10, editValue.length) * 0.6 + 2}em`,
							minWidth: '8em',
							maxWidth: '30em',
						}}
					/>
					<Button
						variant="ghost"
						size="icon"
						onClick={saveEdit}
						onMouseDown={(e) => e.preventDefault()}
						className="h-5 w-5"
						aria-label="Save title"
					>
						<Check className="h-3 w-3" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={cancelEdit}
						onMouseDown={(e) => e.preventDefault()}
						className="h-5 w-5"
						aria-label="Cancel edit"
					>
						<X className="h-3 w-3" />
					</Button>
				</div>
			) : (
				<BreadcrumbPage className="flex min-w-0 max-w-[clamp(8rem,28vw,30rem)] items-center gap-1">
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="min-w-0 truncate">{displayTitle}</span>
						</TooltipTrigger>
						<TooltipContent className="max-w-[600px]">{displayTitle}</TooltipContent>
					</Tooltip>
					{canManageSession && (
						<Button
							variant="ghost"
							size="icon"
							onClick={startEdit}
							className="h-5 w-5 shrink-0 opacity-50 hover:opacity-100"
							aria-label="Edit session title"
						>
							<Pencil className="h-3 w-3" />
						</Button>
					)}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onClick={() => void copySessionDeepLink(sessionId)}
								className="h-5 w-5 shrink-0 opacity-50 hover:opacity-100"
								aria-label="Copy session link"
							>
								<LinkIcon className="h-3 w-3" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							<p className="flex items-center gap-1">
								Copy session link <KeyboardShortcut size="xs">{copyLinkShortcut}</KeyboardShortcut>
							</p>
						</TooltipContent>
					</Tooltip>
				</BreadcrumbPage>
			)}
		</>
	)
}
