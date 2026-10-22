import type { Session } from '@humanlayer/db/tables/sessions'
import { useLocation, useNavigate, useSearch } from '@tanstack/react-router'

import { toMs } from '@/minimalist/lib/format'
import type { PanelTab } from '@/minimalist/lib/thread-panel'

export type TaskNavigationSearch = {
	session?: string
	artifactId?: string
	commentId?: string
	comment?: string
	diffFileId?: string
	diffCommentId?: string
	focus?: 'workspace'
	view?: 'changes'
	pr?: boolean
}

const SESSION_KEY = 'hl-min-task-session:'

export function rememberedSession(taskId: string): string | null {
	try {
		return localStorage.getItem(`${SESSION_KEY}${taskId}`)
	} catch {
		return null
	}
}

export function rememberSession(taskId: string, sessionId: string) {
	try {
		localStorage.setItem(`${SESSION_KEY}${taskId}`, sessionId)
	} catch {
		// Navigation still works when storage is unavailable.
	}
}

/** Explicit history links may name an archived session; ordinary landing never does. */
export function chooseTaskSession(sessions: readonly Session[], explicit?: string, remembered?: string | null) {
	if (explicit) return sessions.find((session) => session.id === explicit) ?? null
	const active = sessions.filter((session) => !session.archived && session.status !== 'draft')
	return (
		active.find((session) => session.id === remembered) ??
		[...active].sort(
			(a, b) =>
				Math.max(toMs(b.last_activity_at), toMs(b.updated_at), toMs(b.created_at)) -
				Math.max(toMs(a.last_activity_at), toMs(a.updated_at), toMs(a.created_at)),
		)[0] ??
		null
	)
}

/** All task destinations share URL state, so copied links and browser history reproduce the layout. */
export function useTaskNavigation(taskId: string | null, sessionId?: string) {
	const navigate = useNavigate()
	const search = useSearch({ strict: false }) as TaskNavigationSearch
	const relink = useLocation({ select: (location) => (location.state as { relink?: number }).relink })
	const go = (next: TaskNavigationSearch) => {
		if (taskId) void navigate({ to: '/tasks/$taskId', params: { taskId }, search: next })
	}
	return {
		search,
		relink,
		open: (tab: PanelTab, file?: string) => {
			if (tab === 'pr') go({ ...search, session: sessionId, pr: true })
			else if (tab === 'review') go({ session: sessionId, view: 'changes', diffFileId: file })
			else go({ session: sessionId, artifactId: tab.slice('artifact:'.length) })
		},
		closePr: () => go({ ...search, session: sessionId, pr: undefined }),
		selectSession: (id: string) => go({ session: id }),
	}
}
