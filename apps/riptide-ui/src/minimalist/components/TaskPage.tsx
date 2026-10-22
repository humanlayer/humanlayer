import type { Task } from '@humanlayer/db/tables/tasks'
import { Link } from '@tanstack/react-router'
import { MessageSquare, PanelLeft, PanelRightClose } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { TaskDiffScope } from '@/components/diffs/TaskDiffScope'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useSessionAccess } from '@/minimalist/lib/access'
import { useTask, useTaskArtifacts } from '@/minimalist/lib/data'
import { canReview } from '@/minimalist/lib/data'
import {
	chooseTaskSession,
	rememberedSession,
	rememberSession,
	useTaskNavigation,
} from '@/minimalist/lib/task-navigation'
import { useTaskTerminal, useTerminalShortcut } from '@/minimalist/lib/terminal'
import { linkRequest } from '@/minimalist/lib/thread-panel'
import { useUi } from '@/minimalist/lib/ui-state'

import { ArtifactView } from './ArtifactPanel'
import { PullRequestPanel } from './PullRequestPanel'
import { ResizeHandle } from './ResizeHandle'
import { ReviewPanel } from './ReviewPanel'
import { TerminalPanel } from './TerminalPanel'
import { ThreadView } from './ThreadView'
import { WiredTaskNavigation } from './WiredTaskNavigation'
import { WorkspaceSetup } from './WorkspaceSetup'

export function MinimalistTaskPage({ taskId, sessionId }: { taskId: string; sessionId?: string }) {
	const { task, sessions, isReady } = useTask(taskId)
	const artifacts = useTaskArtifacts(taskId)
	const session = chooseTaskSession(sessions, sessionId, rememberedSession(taskId))
	const { canSendPrompt } = useSessionAccess(session ?? undefined)
	const targetSessionId = session && !session.archived && canSendPrompt ? session.id : null
	const navigation = useTaskNavigation(taskId, session?.id)
	const { search, relink } = navigation
	const { taskSidebarOpen, toggleTaskSidebar, panelOpen, togglePanel } = useUi()
	const terminal = useTaskTerminal(taskId)
	useTerminalShortcut(terminal.toggle)
	const [compact, setCompact] = useState(() => matchMedia('(max-width: 1200px)').matches)
	useMountEffect(() => {
		const query = matchMedia('(max-width: 1200px)')
		const update = () => setCompact(query.matches)
		query.addEventListener('change', update)
		return () => query.removeEventListener('change', update)
	})
	const changes = Boolean(
		task && canReview(task) && (search.view === 'changes' || search.diffFileId || search.diffCommentId),
	)
	const artifactId = search.artifactId
	const hasArtifact = Boolean(artifactId && !changes)
	const pr = Boolean(search.pr && task && canReview(task))
	const sessionVisible = !changes && (!hasArtifact || !pr)
	const sessionRead = sessionVisible && (!hasArtifact || !compact || panelOpen)
	const opener = useRef<HTMLElement | null>(null)
	const drawerOpen =
		(taskSidebarOpen && matchMedia('(max-width: 1050px)').matches) || (panelOpen && compact && (hasArtifact || pr))
	useEffect(() => {
		if (!drawerOpen) return
		opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
		const selector =
			taskSidebarOpen && matchMedia('(max-width: 1050px)').matches ? '.task-nav' : '.task-right:not([hidden])'
		const frame = requestAnimationFrame(() =>
			document.querySelector<HTMLElement>(`${selector} button, ${selector} a`)?.focus(),
		)
		return () => {
			cancelAnimationFrame(frame)
			if (opener.current?.isConnected && opener.current.getClientRects().length) opener.current.focus()
			else document.querySelector<HTMLElement>('.task-primary:not([hidden])')?.focus()
		}
	}, [drawerOpen, taskSidebarOpen])
	// Keep readers mounted after a visit: switching destinations must not discard a comment draft.
	const [visited, setVisited] = useState<string[]>(artifactId ? [artifactId] : [])
	if (artifactId && !visited.includes(artifactId)) setVisited([...visited, artifactId])
	const focus = useMemo(
		() => linkRequest(search, artifacts, Boolean(task && canReview(task))),
		[search, artifacts, task, relink],
	)
	useEffect(() => {
		if (session && !session.archived) rememberSession(taskId, session.id)
	}, [taskId, session?.id, session?.archived])
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			if (taskSidebarOpen && matchMedia('(max-width: 1050px)').matches) toggleTaskSidebar()
			else if (panelOpen && matchMedia('(max-width: 1200px)').matches) togglePanel()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [taskSidebarOpen, toggleTaskSidebar, panelOpen, togglePanel])

	const content = (
		<div
			className={`task-content${hasArtifact ? ' reading-artifact' : ''}${changes ? ' reading-changes' : ''}${pr ? ' showing-pr' : ''}${panelOpen ? ' right-open' : ''}`}
		>
			<div className="task-content-bar">
				<button
					type="button"
					className="iconbtn"
					aria-label="Open task navigation"
					aria-expanded={taskSidebarOpen}
					onClick={toggleTaskSidebar}
				>
					<PanelLeft className="i" />
				</button>
				<span className="t">{task?.name}</span>
				<span className="sp" />
				{(hasArtifact && session) || pr ? (
					<button
						type="button"
						className="btn ghost"
						aria-label={pr ? 'Open pull request panel' : 'Open session panel'}
						onClick={togglePanel}
					>
						<MessageSquare className="i sm" />
						{pr ? 'Pull requests' : 'Session'}
					</button>
				) : null}
			</div>
			{/* This position never changes when moving a session between main and right. */}
			<div
				className={`task-thread${hasArtifact ? ' task-right' : ' task-primary'}`}
				hidden={!sessionVisible}
				tabIndex={-1}
				aria-label={hasArtifact ? 'Companion session' : 'Session'}
			>
				{session ? (
					<ThreadView
						key={session.id}
						sessionId={session.id}
						taskManaged
						visible={sessionRead}
						workspaceFocused={search.focus === 'workspace'}
					/>
				) : !hasArtifact && !changes ? (
					<NoSession task={task} isReady={isReady} requestedSession={sessionId} />
				) : null}
				{terminal.open && terminal.directory ? (
					<TerminalPanel
						storageKey={terminal.storageKey}
						directory={terminal.directory}
						onClose={terminal.close}
					/>
				) : null}
				{hasArtifact ? <ResizeHandle pane="task-right" edge="left" /> : null}
			</div>
			{task
				? visited.map((id) => {
						const artifact = artifacts.find((entry) => entry.id === id)
						return (
							<main
								key={id}
								className="main task-primary task-artifact"
								tabIndex={-1}
								hidden={!hasArtifact || artifactId !== id}
								aria-label="Artifact"
							>
								{artifact ? (
									<ArtifactView
										task={task}
										artifact={artifact}
										sessionId={targetSessionId}
										focus={focus?.tab === `artifact:${id}` ? focus : undefined}
									/>
								) : (
									<div className="empty pad">
										This artifact doesn't exist or isn't shared with you.
									</div>
								)}
							</main>
						)
					})
				: null}
			{task && canReview(task) ? (
				<main className="main task-primary task-changes" tabIndex={-1} hidden={!changes} aria-label="Changes">
					<ReviewPanel
						task={task}
						sessionId={targetSessionId}
						focus={focus?.tab === 'review' ? focus : null}
					/>
				</main>
			) : null}
			{pr && task ? (
				<aside className="task-right task-pr" aria-label="Pull requests">
					<div className="phead">
						<span>Pull requests</span>
						<span className="sp" />
						<button
							type="button"
							className="iconbtn"
							aria-label="Close pull request panel"
							onClick={navigation.closePr}
						>
							<PanelRightClose className="i" />
						</button>
					</div>
					<PullRequestPanel taskId={task.id} sessionId={targetSessionId} />
					<ResizeHandle pane="task-right" edge="left" />
				</aside>
			) : null}
			{hasArtifact && session && !pr ? (
				<button
					className="task-right-close iconbtn"
					type="button"
					aria-label="Close session panel"
					onClick={togglePanel}
				>
					<PanelRightClose className="i" />
				</button>
			) : null}
			{panelOpen && (hasArtifact || pr) ? (
				<button
					className="task-right-scrim"
					type="button"
					aria-label="Close right panel"
					onClick={togglePanel}
				/>
			) : null}
		</div>
	)
	// The navigation sits inside the diff scope too, so its Changes row can count lines.
	const layout = (body: ReactNode) => (
		<div className="task-layout">
			<WiredTaskNavigation taskId={taskId} sessionId={session?.id} />
			{taskSidebarOpen ? (
				<button
					className="task-nav-scrim"
					type="button"
					aria-label="Close task navigation"
					onClick={toggleTaskSidebar}
				/>
			) : null}
			{body}
		</div>
	)
	return task && (session || canReview(task)) ? (
		<TaskDiffScope
			taskId={taskId}
			loading={layout(
				<div className="main">
					<div className="boot-mark" />
				</div>,
			)}
			missing={layout(content)}
		>
			{layout(content)}
		</TaskDiffScope>
	) : (
		layout(content)
	)
}

function NoSession({
	task,
	isReady,
	requestedSession,
}: {
	task: Task | null
	isReady: boolean
	requestedSession?: string
}) {
	if (!isReady)
		return (
			<main className="main">
				<div className="hero">
					<div className="boot-mark" />
				</div>
			</main>
		)
	if (!task)
		return (
			<main className="main">
				<div className="hero">
					<h1 className="status">This task doesn't exist or isn't shared with you</h1>
				</div>
			</main>
		)
	if (requestedSession)
		return (
			<main className="main">
				<div className="hero">
					<h1 className="status">This session doesn't exist or isn't shared with you</h1>
				</div>
			</main>
		)
	if (task.is_draft)
		return (
			<main className="main">
				<div className="hero">
					<h1 className="status">This task is a draft</h1>
					<Link className="btn" to="/tasks/new" search={{ draftId: task.id }}>
						Open the draft
					</Link>
				</div>
			</main>
		)
	return (
		<main className="main">
			<div className="hero">
				<h1 className="status">No sessions yet</h1>
				<Link className="btn" to="/" search={{ task: task.id }}>
					New session
				</Link>
			</div>
			<div className="scroll">
				<div className="col">
					<WorkspaceSetup taskId={task.id} waitingForWorkspace={false} />
				</div>
			</div>
		</main>
	)
}
