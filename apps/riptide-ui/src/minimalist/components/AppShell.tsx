import { useLocation, useNavigate } from '@tanstack/react-router'
import { PanelLeft } from 'lucide-react'
import { type ReactNode, useLayoutEffect, useRef } from 'react'

import { useNotificationInboxStore } from '@/hooks/stores/notificationInboxStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { nextJumpRow } from '@/lib/notifications/next-jump-row'
import { FileDropOverlay } from '@/minimalist/components/FileDropOverlay'
import { Notifier } from '@/minimalist/components/Notifier'
import { SearchPalette } from '@/minimalist/components/SearchPalette'
import { Sidebar } from '@/minimalist/components/Sidebar'
import { Toast } from '@/minimalist/components/Toast'
import { useOpenTaskId, useTaskTree } from '@/minimalist/lib/data'
import { useMinimalistInbox } from '@/minimalist/lib/inbox'
import { matchShortcut, type ShortcutId } from '@/minimalist/lib/shortcuts'
import { useUi } from '@/minimalist/lib/ui-state'
import { useArchive } from '@/minimalist/lib/use-archive'
import { useUnreadActions } from '@/minimalist/lib/use-unread'

export function AppShell({ children }: { children: ReactNode }) {
	const ui = useUi()
	const navigate = useNavigate()
	const { groups, recent } = useTaskTree()
	const { rows, openNotification } = useMinimalistInbox()
	const { pathname } = useLocation()
	const inSettings = pathname.startsWith('/settings')
	const ordered = groups.flatMap((group) => group.tasks)
	const currentTaskId = useOpenTaskId() ?? null
	const openTask = (taskId: string | undefined) => {
		if (taskId) void navigate({ to: '/tasks/$taskId', params: { taskId } })
	}
	const { archive } = useArchive()
	const { markUnread } = useUnreadActions()
	const step = (by: 1 | -1) => {
		const index = ordered.findIndex((row) => row.task.id === currentTaskId)
		openTask(ordered[index === -1 ? 0 : (index + by + ordered.length) % ordered.length]?.task.id)
	}
	// Fork runs in the thread, which knows your last message.
	const actions: Partial<Record<ShortcutId, (digit: number) => void>> = {
		'new-task': () => void navigate({ to: '/', search: {} }),
		search: () => ui.setSearchOpen(true),
		settings: () => void navigate({ to: '/settings/general' }),
		sidebar: ui.toggleSidebar,
		panel: ui.togglePanel,
		back: () => window.history.back(),
		forward: () => window.history.forward(),
		'next-task': () => step(1),
		'previous-task': () => step(-1),
		recent: (digit) => openTask(recent[digit - 1]?.task.id),
		archive: () => {
			if (currentTaskId) void archive({ kind: 'task', id: currentTaskId }, true)
		},
		'mark-unread': () => {
			const latest = ordered.find((row) => row.task.id === currentTaskId)?.latest
			if (currentTaskId && latest) void markUnread(currentTaskId, latest.id)
		},
		attention: ui.toggleAttentionView,
		'next-attention': () => {
			const next = nextJumpRow(rows, useNotificationInboxStore.getState().opened)
			if (next) openNotification(next)
			else ui.showAttentionView()
		},
	}
	const onKey = (event: KeyboardEvent) => {
		if (event.defaultPrevented || event.isComposing) return
		const hit = matchShortcut(event)
		const run = hit ? actions[hit.id] : undefined
		if (!hit || !run) return
		event.preventDefault()
		run(hit.digit)
	}
	const currentKeyHandler = useRef(onKey)
	useLayoutEffect(() => {
		currentKeyHandler.current = onKey
	})
	useMountEffect(() => {
		// Tabs and portal menus sit outside this shell; they still need the app's shortcuts.
		const handler = (event: KeyboardEvent) => currentKeyHandler.current(event)
		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	})

	return (
		<div
			className={`app ${!ui.sidebarOpen && !inSettings ? 'sidebar-closed' : ''}`}
			role="group"
			aria-label="HumanLayer"
			tabIndex={-1}
		>
			{ui.sidebarOpen && !inSettings ? <Sidebar /> : null}
			{ui.sidebarOpen && !inSettings ? (
				<button className="sidebar-scrim" type="button" aria-label="Close sidebar" onClick={ui.toggleSidebar} />
			) : null}
			{!ui.sidebarOpen && !inSettings ? (
				<button
					type="button"
					className="iconbtn sidebar-reopen"
					title="Open sidebar"
					aria-label="Open sidebar"
					onClick={ui.toggleSidebar}
				>
					<PanelLeft className="i" />
				</button>
			) : null}
			{children}
			<SearchPalette />
			<Notifier />
			<Toast />
			<FileDropOverlay />
		</div>
	)
}
