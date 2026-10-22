import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from '@humanlayer/ui/components/command'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Label } from '@humanlayer/ui/components/label'
import { renderSessionStatusIndicator, UnreadBullet } from '@humanlayer/ui/components/sidebar/status-indicators'
import { Switch } from '@humanlayer/ui/components/switch'
import { and, eq, ilike, not, or, useLiveQuery } from '@tanstack/react-db'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useDebounce } from '@uidotdev/usehooks'
import { useAuth } from '@workos-inc/authkit-react'
import { AppWindow, Bot, Keyboard, LayoutTemplate, Plus, RefreshCw } from 'lucide-react'
import { Fragment, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { useSync } from '@/components/providers/SyncProvider'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useCommandPaletteStore } from '@/hooks/stores/commandPaletteStore'
import { useHotkeyHelpStore } from '@/hooks/stores/hotkeyHelpStore'
import { useUnreadStore } from '@/hooks/stores/unreadStore'
import { useToggleMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { hotkeysCatalog, type ShortcutDisplay, type ShortcutKeys, shortcutPlatform } from '@/hotkeysCatalog'
import { openNewWindow } from '@/integrations/desktop/window'
import { NAVIGATION_PAGE_METADATA } from '@/lib/navigation-page-metadata'
import { navigateToSettings } from '@/lib/settings-navigation'
import { isElectron } from '@/lib/utils'
import { toTableSession } from '@/utils/session-transforms'

// Every palette row gets the focus treatment used by the session table: a soft tint and a 2px
// accent bar on the left, instead of cmdk's default full-contrast flip. These are scoped to the
// dialog so the comboboxes that share CommandItem keep the default styling.
const PALETTE_ITEM_STYLES = [
	'[&_[data-slot=command-item]]:rounded-none',
	'[&_[data-slot=command-item]]:border-l-2',
	'[&_[data-slot=command-item]]:border-l-transparent',
	'[&_[data-slot=command-item][data-selected=true]]:border-l-[var(--terminal-accent)]',
	'[&_[data-slot=command-item][data-selected=true]]:bg-accent/10',
	'[&_[data-slot=command-item][data-selected=true]]:text-foreground',
	"[&_[data-slot=command-item][data-selected=true]_svg:not([class*='text-'])]:text-muted-foreground",
].join(' ')

const TasksIcon = NAVIGATION_PAGE_METADATA.tasks.Icon
const SessionsIcon = NAVIGATION_PAGE_METADATA.sessions.Icon
const DraftsIcon = NAVIGATION_PAGE_METADATA.drafts.Icon
const NewTaskIcon = NAVIGATION_PAGE_METADATA.newTask.Icon
const SettingsIcon = NAVIGATION_PAGE_METADATA.settings.Icon
const ArchivedTasksIcon = NAVIGATION_PAGE_METADATA.archivedTasks.Icon
const ArchivedSessionsIcon = NAVIGATION_PAGE_METADATA.archivedSessions.Icon

function buildTaskCommandValue(task: { id: string }) {
	return task.id
}

function buildTaskCommandKeywords(task: { name: string | null | undefined }) {
	return [task.name ?? '']
}

function buildSessionCommandValue(session: { id: string }) {
	return session.id
}

function buildSessionCommandKeywords(session: {
	title?: string
	summary?: string
	taskName?: string
	workingDirectory?: string
	model?: string
}) {
	return [
		session.title ?? '',
		session.summary ?? '',
		session.taskName ?? '',
		session.workingDirectory ?? '',
		session.model ?? '',
	]
}

function PaletteKeycap({ children }: { children: string }) {
	return (
		<KeyboardShortcut size="xs" className="h-5 min-w-5 justify-center px-1.5 text-[10px]!">
			{children}
		</KeyboardShortcut>
	)
}

function PaletteShortcutKeys({ keys }: { keys: ShortcutKeys }) {
	if ('sequence' in keys) return <PaletteKeycap>{keys.sequence.join(',')}</PaletteKeycap>

	const combinations = 'combination' in keys ? [keys.combination] : keys.alternatives
	return combinations.map((combination, index) => (
		<Fragment key={`${combination.join('-')}-${index}`}>
			{index > 0 && <span className="px-0.5 text-[9px] text-muted-foreground">or</span>}
			{combination.map((key, keyIndex) => (
				<PaletteKeycap key={`${key}-${keyIndex}`}>{key}</PaletteKeycap>
			))}
		</Fragment>
	))
}

function PaletteShortcut({ shortcut }: { shortcut: string | ShortcutDisplay }) {
	return (
		<CommandShortcut className="flex items-center gap-1 tracking-normal">
			{typeof shortcut === 'string' ? (
				<PaletteKeycap>{shortcut}</PaletteKeycap>
			) : (
				<PaletteShortcutKeys keys={shortcut[shortcutPlatform]} />
			)}
		</CommandShortcut>
	)
}

function RecentSessionStatusIcon({ status, isUnread }: { status?: string | null; isUnread: boolean }) {
	const indicator = renderSessionStatusIndicator(status)
	return (
		<span className="flex size-4 shrink-0 items-center justify-center overflow-hidden">
			{indicator ?? (isUnread ? <UnreadBullet /> : null)}
		</span>
	)
}

export function CommandPalette() {
	const navigate = useNavigate()
	const currentSessionId = useParams({ strict: false, select: (params) => params.sessionId })
	const { sessionsCollection, tasksCollection } = useSync()
	const { user } = useAuth()

	// Stores
	const { isOpen, close, searchValue, setSearchValue, searchIncludeShared, setSearchIncludeShared } =
		useCommandPaletteStore()
	const registeredActions = useCommandPaletteStore(useShallow((s) => [...s.actions.values()]))
	const unreadSessionIds = useUnreadStore((s) => s.unreadSessionIds)

	// Debounced search
	const debouncedSearch = useDebounce(searchValue, 150)

	const { data: recentSessions } = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined
			let query = q
				.from({ sessions: sessionsCollection })
				.leftJoin({ tasks: tasksCollection }, ({ sessions, tasks }) => eq(sessions.task_id, tasks.id))
				.where(({ sessions }) =>
					and(
						eq(sessions.resource_owner_user_id, user.id),
						not(eq(sessions.archived, true)),
						not(eq(sessions.status, 'draft')),
					),
				)

			if (currentSessionId) {
				query = query.where(({ sessions }) => not(eq(sessions.id, currentSessionId)))
			}

			return query
				.orderBy(({ sessions }) => sessions.last_activity_at, 'desc')
				.limit(3)
				.select(({ sessions, tasks }) => ({
					id: sessions.id,
					title: sessions.title,
					summary: sessions.summary,
					status: sessions.status,
					taskName: tasks?.name,
				}))
		},
		[sessionsCollection, tasksCollection, user?.id, currentSessionId],
	)

	// Session search query — searches session title/summary only; prompt text is intentionally excluded
	const { data: searchResults } = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined
			if (debouncedSearch.length < 2) {
				return undefined
			}
			const pattern = `%${debouncedSearch}%`
			return q
				.from({ sessions: sessionsCollection })
				.where(({ sessions }) => {
					const searchFilter = or(ilike(sessions.title, pattern), ilike(sessions.summary, pattern))
					return searchIncludeShared
						? searchFilter
						: and(searchFilter, eq(sessions.resource_owner_user_id, user.id))
				})
				.orderBy(({ sessions }) => sessions.last_activity_at, 'desc')
				.limit(5)
		},
		[sessionsCollection, debouncedSearch, user?.id, searchIncludeShared],
	)

	// Sort with 15-second bucketing to stabilize order; archived sessions are deprioritized below active ones
	const sessionResults = useMemo(() => {
		if (!searchResults) return []
		return [...searchResults]
			.sort((a, b) => {
				if (a.archived !== b.archived) return a.archived ? 1 : -1
				const bucketA = Math.floor(Number(a.last_activity_at) / 15000)
				const bucketB = Math.floor(Number(b.last_activity_at) / 15000)
				if (bucketB !== bucketA) return bucketB - bucketA
				return Number(b.created_at) - Number(a.created_at)
			})
			.map(toTableSession)
	}, [searchResults])

	// Task search query — searches all synced tasks (including shared) unless searchIncludeShared is on
	const { data: taskSearchResults } = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined
			if (debouncedSearch.length < 2) {
				return undefined
			}
			const pattern = `%${debouncedSearch}%`
			return q
				.from({ tasks: tasksCollection })
				.where(({ tasks }) =>
					searchIncludeShared
						? ilike(tasks.name, pattern)
						: and(ilike(tasks.name, pattern), eq(tasks.resource_owner_user_id, user.id)),
				)
				.orderBy(({ tasks }) => tasks.updated_at, 'desc')
				.limit(5)
		},
		[tasksCollection, debouncedSearch, user?.id, searchIncludeShared],
	)

	// Task results — archived tasks are deprioritized below active ones (stable sort preserves updated_at order)
	const taskResults = useMemo(() => {
		if (!taskSearchResults) return []
		return [...taskSearchResults].sort((a, b) => {
			if (a.archived !== b.archived) return a.archived ? 1 : -1
			return 0
		})
	}, [taskSearchResults])

	// Actions
	const handleCreateSession = useCallback(() => {
		close()
		navigate({ to: '/sessions/draft' })
	}, [close, navigate])

	const handleConfigureWorkspaces = useCallback(() => {
		close()
		navigate({
			to: '/sessions/draft',
			search: { slashCommand: '/rpi:configure-workspaces' },
		})
	}, [close, navigate])

	const handleCreateTask = useCallback(() => {
		close()
		navigate({ to: '/tasks/new' })
	}, [close, navigate])

	const handleOpenSettings = useCallback(() => {
		close()
		navigateToSettings(navigate)
	}, [close, navigate])

	const handleCheckForUpdates = () => {
		close()
		void navigate({ to: '/settings/updates', search: { updateCheck: true } })
	}

	const toggleMinimalistLayout = useToggleMinimalistLayout()
	const handleToggleMinimalist = () => {
		close()
		toggleMinimalistLayout()
	}

	const handleOpenHotkeyHelp = useCallback(() => {
		close()
		useHotkeyHelpStore.getState().open()
	}, [close])

	const handleOpenNewWindow = () => {
		close()
		void openNewWindow()
	}

	const handleGoToSessions = useCallback(() => {
		close()
		navigate({ to: '/sessions', search: { tab: 'sessions' } })
	}, [close, navigate])

	const handleGoToTasks = useCallback(() => {
		close()
		navigate({ to: '/sessions', search: { tab: 'tasks' } })
	}, [close, navigate])

	const handleGoToDrafts = useCallback(() => {
		close()
		navigate({ to: '/sessions', search: { tab: 'drafts' } })
	}, [close, navigate])

	const handleGoToArchive = useCallback(() => {
		close()
		navigate({ to: '/archive/sessions' })
	}, [close, navigate])

	const handleGoToArchivedTasks = useCallback(() => {
		close()
		navigate({ to: '/archive/tasks' })
	}, [close, navigate])

	const handleSelectSession = useCallback(
		(sessionId: string) => {
			close()
			navigate({ to: '/sessions/$sessionId', params: { sessionId } })
		},
		[close, navigate],
	)

	const handleSelectTask = useCallback(
		(taskId: string) => {
			close()
			navigate({ to: '/tasks/$taskId', params: { taskId } })
		},
		[close, navigate],
	)

	// Handle dialog open/close
	const handleOpenChange = useCallback(
		(open: boolean) => {
			if (!open) {
				close() // close() also resets searchValue
			}
		},
		[close],
	)

	// Hotkey for Option+S to toggle search owned only
	useHotkeys(
		'alt+s',
		(e) => {
			e.preventDefault()
			const store = useCommandPaletteStore.getState()
			store.setSearchIncludeShared(!store.searchIncludeShared)
		},
		{
			scopes: [HOTKEY_SCOPES.COMMAND_PALETTE],
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
	)

	// Hotkey for Cmd+K to toggle
	useHotkeys(
		hotkeysCatalog.global.shortcuts.commandPalette.reactHotkeys,
		(e) => {
			e.preventDefault()
			useCommandPaletteStore.getState().toggle()
		},
		{
			scopes: [
				HOTKEY_SCOPES.ROOT,
				HOTKEY_SCOPES.SESSIONS_LIST,
				HOTKEY_SCOPES.SESSION_DETAIL,
				HOTKEY_SCOPES.DRAFT_LAUNCHER,
				HOTKEY_SCOPES.TASK_NEW,
			],
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.COMMAND_PALETTE}
			isActive={isOpen}
			rootScopeDisabled={true}
			componentName="CommandPalette"
		>
			<CommandDialog
				open={isOpen}
				onOpenChange={handleOpenChange}
				showCloseButton={false}
				className={`sm:max-w-xl top-[15%] translate-y-0 border-0 [&_[data-slot=command-input-wrapper]]:border-0 [&_[data-slot=command-input-wrapper]]:bg-accent/5 ${PALETTE_ITEM_STYLES}`}
			>
				<CommandInput
					placeholder="Search commands, tasks, and sessions..."
					value={searchValue}
					onValueChange={setSearchValue}
				/>
				<CommandList>
					<CommandEmpty>
						{debouncedSearch.length >= 2 ? 'No results found.' : 'Type to search tasks and sessions...'}
					</CommandEmpty>

					{searchValue.length === 0 && recentSessions && recentSessions.length > 0 && (
						<CommandGroup heading="Recent">
							{recentSessions.map((session) => (
								<CommandItem
									key={session.id}
									value={buildSessionCommandValue(session)}
									keywords={buildSessionCommandKeywords({
										title: session.title ?? undefined,
										summary: session.summary ?? undefined,
										taskName: session.taskName ?? undefined,
									})}
									onSelect={() => handleSelectSession(session.id)}
									className="flex items-center gap-3 px-5 py-3"
								>
									<SessionsIcon className="w-4 h-4 text-muted-foreground shrink-0" />
									<RecentSessionStatusIcon
										status={session.status}
										isUnread={unreadSessionIds.has(session.id)}
									/>
									{session.taskName ? (
										<span className="flex items-center gap-1.5 min-w-0 flex-1">
											<span className="shrink-0 max-w-[20ch] truncate">{session.taskName}</span>
											<span className="recent-session-caret shrink-0 text-primary font-semibold">
												›
											</span>
											<span className="truncate min-w-0">
												{session.title || session.summary || 'Untitled Session'}
											</span>
										</span>
									) : (
										<span className="truncate flex-1">
											{session.title || session.summary || 'Untitled Session'}
										</span>
									)}
								</CommandItem>
							))}
						</CommandGroup>
					)}

					{/* Actions Group */}
					<CommandGroup heading="Actions">
						{isElectron() && (
							<CommandItem onSelect={handleOpenNewWindow}>
								<AppWindow className="mr-2 h-4 w-4" />
								<span>New Window</span>
							</CommandItem>
						)}
						<CommandItem onSelect={handleCreateSession}>
							<Plus className="mr-2 h-4 w-4" />
							<span>Create Session</span>
							<PaletteShortcut
								shortcut={hotkeysCatalog.navigationAndCreation.shortcuts.createSession.display}
							/>
						</CommandItem>

						<CommandItem onSelect={handleConfigureWorkspaces}>
							<Bot className="mr-2 h-4 w-4" />
							<span>Configure Workspaces</span>
						</CommandItem>

						<CommandItem onSelect={handleCreateTask}>
							<NewTaskIcon className="mr-2 h-4 w-4" />
							<span>Create Task</span>
							<PaletteShortcut
								shortcut={hotkeysCatalog.navigationAndCreation.shortcuts.createTask.display}
							/>
						</CommandItem>

						<CommandItem onSelect={handleOpenSettings}>
							<SettingsIcon className="mr-2 h-4 w-4" />
							<span>Settings</span>
							<PaletteShortcut shortcut={hotkeysCatalog.global.shortcuts.settings.display} />
						</CommandItem>

						<CommandItem onSelect={handleCheckForUpdates}>
							<RefreshCw className="mr-2 h-4 w-4" />
							<span>Check for updates</span>
						</CommandItem>

						<CommandItem onSelect={handleToggleMinimalist}>
							<LayoutTemplate className="mr-2 h-4 w-4" />
							<span>Toggle Minimalist UI</span>
						</CommandItem>

						<CommandItem onSelect={handleOpenHotkeyHelp}>
							<Keyboard className="mr-2 h-4 w-4" />
							<span>Hotkeys Guide</span>
							<PaletteShortcut shortcut={hotkeysCatalog.global.shortcuts.hotkeyHelp.display} />
						</CommandItem>

						<CommandItem onSelect={handleGoToSessions}>
							<SessionsIcon className="mr-2 h-4 w-4" />
							<span>Go to {NAVIGATION_PAGE_METADATA.sessions.label}</span>
						</CommandItem>

						<CommandItem onSelect={handleGoToTasks}>
							<TasksIcon className="mr-2 h-4 w-4" />
							<span>Go to {NAVIGATION_PAGE_METADATA.tasks.label}</span>
						</CommandItem>

						<CommandItem onSelect={handleGoToDrafts}>
							<DraftsIcon className="mr-2 h-4 w-4" />
							<span>Go to {NAVIGATION_PAGE_METADATA.drafts.label}</span>
						</CommandItem>

						<CommandItem onSelect={handleGoToArchive}>
							<ArchivedSessionsIcon className="mr-2 h-4 w-4" />
							<span>Go to {NAVIGATION_PAGE_METADATA.archivedSessions.label}</span>
						</CommandItem>

						<CommandItem onSelect={handleGoToArchivedTasks}>
							<ArchivedTasksIcon className="mr-2 h-4 w-4" />
							<span>Go to {NAVIGATION_PAGE_METADATA.archivedTasks.label}</span>
						</CommandItem>

						{registeredActions.map((action) => (
							<CommandItem
								key={action.id}
								onSelect={() => {
									close()
									action.onSelect()
								}}
							>
								{action.icon && <action.icon className="mr-2 h-4 w-4" />}
								<span>{action.label}</span>
								{action.shortcut && <PaletteShortcut shortcut={action.shortcut} />}
							</CommandItem>
						))}
					</CommandGroup>

					{/* Search Results - Tasks always appear first */}
					{taskResults.length > 0 && (
						<CommandGroup heading="Tasks">
							{taskResults.map((task) => (
								<CommandItem
									key={task.id}
									value={buildTaskCommandValue(task)}
									keywords={buildTaskCommandKeywords(task)}
									onSelect={() => handleSelectTask(task.id)}
								>
									<TasksIcon className="mr-2 h-4 w-4 shrink-0" />
									<span className="truncate">{task.name}</span>
									<span className="ml-auto flex shrink-0 items-center gap-2">
										{task.resource_owner_user_id !== user?.id && (
											<span className="text-xs rounded-md px-1.5 py-0.5 bg-muted text-muted-foreground">
												shared
											</span>
										)}
										{task.archived && (
											<span className="text-xs text-muted-foreground/70">Archived</span>
										)}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					)}

					{sessionResults.length > 0 && (
						<CommandGroup heading="Sessions">
							{sessionResults.map((session) => (
								<CommandItem
									key={session.id}
									value={buildSessionCommandValue(session)}
									keywords={buildSessionCommandKeywords(session)}
									onSelect={() => handleSelectSession(session.id)}
								>
									<SessionsIcon className="mr-2 h-4 w-4 shrink-0" />
									<span className="truncate">
										{session.title || session.summary || session.query || 'Untitled Session'}
									</span>
									<span className="ml-auto flex shrink-0 items-center gap-2">
										{session.resourceOwnerUserId !== user?.id && (
											<span className="text-xs rounded-md px-1.5 py-0.5 bg-muted text-muted-foreground">
												shared
											</span>
										)}
										{session.archived && (
											<span className="text-xs text-muted-foreground/70">Archived</span>
										)}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					)}
				</CommandList>

				{/* Footer with hints and filter */}
				<div className="bg-accent/5 px-3 py-2 text-xs text-muted-foreground flex justify-between items-center">
					<div className="flex gap-3">
						<span>↑↓ Navigate</span>
						<span>↵ Select</span>
					</div>
					<div className="flex items-center gap-2">
						<Label
							htmlFor="search-include-shared"
							className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1"
						>
							Include shared
							<kbd className="px-1 py-0.5 text-[10px] font-medium bg-background/50 rounded border border-border">
								⌥+s
							</kbd>
						</Label>
						<Switch
							id="search-include-shared"
							checked={searchIncludeShared}
							onCheckedChange={setSearchIncludeShared}
							className="scale-75"
						/>
					</div>
				</div>
			</CommandDialog>
		</HotkeyScopeBoundary>
	)
}
