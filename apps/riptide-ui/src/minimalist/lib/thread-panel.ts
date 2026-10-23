import type { Task } from '@humanlayer/db/tables/tasks'
import { eq, queryOnce } from '@tanstack/react-db'
import { type HistoryState, useLocation, useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import type { TaskArtifact } from '@/hooks/live-queries/useTaskArtifacts'
import { isAttachment, isPromptArtifact } from '@/minimalist/lib/artifacts'
import { canReview } from '@/minimalist/lib/data'
import { toMs } from '@/minimalist/lib/format'
import { changesFiles } from '@/minimalist/lib/tools'
import { type EventRow, parseInput } from '@/minimalist/lib/transcript'
import { useUi } from '@/minimalist/lib/ui-state'

export type PanelTab = 'review' | 'pr' | `artifact:${string}`

/**
 * A tab to switch to, optionally with a comment whose thread to show. For Review,
 * also a file to scroll to (a path, or a diff file ID from a link).
 */
export type PanelRequest = { tab: PanelTab; file?: string; comment?: string }
/** Where in a tab a link points. */
export type PanelFocus = Pick<PanelRequest, 'file' | 'comment'>

/**
 * The tab to open for work the agent did after `since`: a document it wrote, or
 * else Review when it changed files in a task that has a diff to review. A call
 * still waiting on approval, or denied, changed nothing.
 */
export function freshWork(
	events: readonly EventRow[],
	artifacts: readonly TaskArtifact[],
	since: number,
	reviewable: boolean,
): PanelTab | null {
	const doc = artifacts.find(
		(artifact) =>
			!isPromptArtifact(artifact) && !isAttachment(artifact) && toMs(artifact.last_updated_at ?? 0) > since,
	)
	if (doc) return `artifact:${doc.id}`
	const edited =
		reviewable &&
		events.some(
			(event) =>
				event.event_type === 'tool_call' &&
				event.tool_name !== null &&
				event.approval_status !== 'pending' &&
				event.approval_status !== 'denied' &&
				toMs(event.created_at) > since &&
				changesFiles(event.tool_name, parseInput(event.tool_input_json)),
		)
	return edited ? 'review' : null
}

/** Navigation state that asks for the link again when the URL already names it (the same alert opened twice). */
export function relink(): HistoryState {
	return { relink: Date.now() } as HistoryState
}

/**
 * Open a task on a document, a document comment or a diff comment, in its side panel.
 * When you're already reading that task, you stay on the session you're in.
 */
export function useOpenInTask() {
	const navigate = useNavigate()
	const router = useRouter()
	const { sessionsCollection } = useSync()
	const sessionHere = async (taskId: string) => {
		const here = router.state.location
		if (here.pathname === `/tasks/${taskId}`) return (here.search as { session?: string }).session
		const open = /^\/sessions\/([^/]+)\/?$/.exec(here.pathname)?.[1]
		if (!open) return undefined
		const session = await queryOnce((q) =>
			q
				.from({ session: sessionsCollection })
				.where(({ session }) => eq(session.id, open))
				.findOne(),
		)
		return session?.task_id === taskId ? open : undefined
	}
	return async (taskId: string, search: { artifactId?: string; commentId?: string; diffCommentId?: string }) => {
		const session = await sessionHere(taskId)
		return navigate({ to: '/tasks/$taskId', params: { taskId }, search: { ...search, session }, state: relink() })
	}
}

/**
 * What a link asks the side panel for: a document (and comment) it names, or else the diff
 * comment or file it names. Notifications name a document comment with `commentId`; the
 * standard UI's copied links and Slack use `comment`.
 */
export function linkRequest(
	search: { artifactId?: string; commentId?: string; comment?: string; diffFileId?: string; diffCommentId?: string },
	artifacts: readonly Pick<TaskArtifact, 'id'>[],
	reviewable: boolean,
): PanelRequest | null {
	const comment = search.commentId ?? search.comment
	if (search.artifactId && artifacts.some((artifact) => artifact.id === search.artifactId))
		return comment ? { tab: `artifact:${search.artifactId}`, comment } : { tab: `artifact:${search.artifactId}` }
	if (reviewable && (search.diffFileId || search.diffCommentId))
		return { tab: 'review', file: search.diffFileId, comment: search.diffCommentId }
	return null
}

/**
 * The thread's side panel. It shows when you open it (button, ⌥⌘B), when a link
 * or button asks for a tab, or on its own the first time the agent changes a
 * file or writes a document while you watch. Closing it any way stops it
 * opening itself again for this visit.
 */
export function useThreadPanel(events: readonly EventRow[], artifacts: readonly TaskArtifact[], task: Task | null) {
	const { panelOpen, togglePanel } = useUi()
	const [openedAt] = useState(() => Date.now())
	const reviewable = task !== null && canReview(task)
	const preferred = useMemo(
		() => freshWork(events, artifacts, openedAt, reviewable),
		[events, artifacts, openedAt, reviewable],
	)
	const [request, setRequest] = useState<PanelRequest | null>(null)
	const [dismissed, setDismissed] = useState(false)

	// ?artifactId=… (a link or the palette) asks for that document, with ?commentId=… a thread
	// in it, and ?diffCommentId=… or ?diffFileId=… (a teammate's link to a diff comment) for
	// Review, once per change.
	const search = useSearch({ strict: false }) as Parameters<typeof linkRequest>[0]
	const link = linkRequest(search, artifacts, reviewable)
	const linkKey = link ? [link.tab, link.file, link.comment].join('|') : null
	const again = useLocation({ select: (location) => (location.state as { relink?: number }).relink })
	const [seen, setSeen] = useState<{ link: string | null; again?: number }>({ link: null })
	if (linkKey !== seen.link || (again !== undefined && again !== seen.again)) {
		setSeen({ link: linkKey, again })
		if (link) {
			setRequest(link)
			setDismissed(false)
		}
	}
	const [wasOpen, setWasOpen] = useState(panelOpen)
	if (wasOpen !== panelOpen) {
		setWasOpen(panelOpen)
		if (!panelOpen) setDismissed(true)
	}

	const show = task !== null && (panelOpen || ((request?.tab ?? preferred) !== null && !dismissed))
	return {
		show,
		preferred,
		request,
		open: (tab: PanelTab, file?: string) => {
			setRequest({ tab, file })
			setDismissed(false)
		},
		toggle: () => (panelOpen ? togglePanel() : show ? setDismissed(true) : togglePanel()),
	}
}

const scrolled = new WeakSet<PanelFocus>()

/**
 * A ref that scrolls its element into view once per request, however often the
 * element remounts after that (a file folded and opened, the agent editing the
 * file or document, a tab switch). Each new link is a new request and scrolls again.
 */
export function scrollOnce(request: PanelFocus | null | undefined, block: ScrollLogicalPosition) {
	return (element: HTMLElement | null) => {
		if (!element || !request || scrolled.has(request)) return
		scrolled.add(request)
		element.scrollIntoView({ block })
	}
}
