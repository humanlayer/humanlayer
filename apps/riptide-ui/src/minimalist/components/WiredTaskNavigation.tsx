import type { Task } from '@humanlayer/db/tables/tasks'
import { Link } from '@tanstack/react-router'
import {
	Copy,
	FileDiff,
	FileText,
	GitPullRequest,
	Image,
	PanelLeftClose,
	Pencil,
	Plus,
	SkipForward,
	SquareArrowOutUpRight,
	SquareTerminal,
} from 'lucide-react'
import { use, useRef, useState } from 'react'

import { TaskDiffContext } from '@/components/diffs/task-diff-context'
import { groupChecks } from '@/components/github/check-groups'
import type { TaskArtifact } from '@/hooks/live-queries/useTaskArtifacts'
import { usePrStatusStream } from '@/hooks/session-detail/usePrStatusStream'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useUnreadStore } from '@/hooks/stores/unreadStore'
import { openInEditor } from '@/integrations/desktop/editor'
import { isPtyAvailable } from '@/integrations/desktop/pty'
import { artifactName, isImageArtifact, isListedArtifact, isPromptArtifact } from '@/minimalist/lib/artifacts'
import { useTaskAutoAdvance } from '@/minimalist/lib/auto-advance'
import { canReview, useSession, useTask, useTaskArtifacts } from '@/minimalist/lib/data'
import { phaseOf } from '@/minimalist/lib/phases'
import { pullRequestBadge, useTaskPullRequest } from '@/minimalist/lib/pull-requests'
import { sessionName } from '@/minimalist/lib/session-name'
import { shortcutHint } from '@/minimalist/lib/shortcuts'
import { isBusy, statusAnnouncement } from '@/minimalist/lib/status'
import { useTaskNavigation } from '@/minimalist/lib/task-navigation'
import { useTaskTerminal } from '@/minimalist/lib/terminal'
import { useUi } from '@/minimalist/lib/ui-state'
import { useCopy } from '@/minimalist/lib/use-copy'
import { useRiptideApi } from '@/orpc/client'

import { ResizeHandle } from './ResizeHandle'
import { useDiffTotals } from './ReviewPanel'
import { WiredTaskDetails } from './TaskDetails'
import { ArtifactRowMenu, type SessionDialog, SessionRowDialog, SessionRowMenu } from './TaskNavMenus'

export function WiredTaskNavigation({ taskId, sessionId }: { taskId: string; sessionId?: string }) {
	const { task, sessions } = useTask(taskId)
	const artifacts = useTaskArtifacts(taskId)
	const navigation = useTaskNavigation(taskId, sessionId)
	const { taskSidebarOpen, toggleTaskSidebar, closeTaskSidebarOnNarrow } = useUi()
	// Newest first: the session you are most likely to want sits under the title.
	const newestFirst = [...sessions].reverse()
	const active = newestFirst.filter((session) => !session.archived && session.status !== 'draft')
	const archived = newestFirst.filter((session) => session.archived && session.status !== 'draft')
	const [showArchived, setShowArchived] = useState(false)
	const documents = artifacts.filter(isListedArtifact)
	const ordered = [
		...documents.filter((artifact) => !isPromptArtifact(artifact)),
		...documents.filter(isPromptArtifact),
	]
	if (!task) return null
	return (
		<aside className={`task-nav${taskSidebarOpen ? ' open' : ''}`} aria-label="Task navigation">
			<header className="task-nav-head">
				<WiredTaskTitle taskId={taskId} />
				<button
					type="button"
					className="iconbtn task-nav-close"
					aria-label="Close task navigation"
					onClick={toggleTaskSidebar}
				>
					<PanelLeftClose className="i" />
				</button>
			</header>
			<WiredTaskTools taskId={taskId} />
			<WiredTaskDetails taskId={taskId} />
			<nav className="task-nav-groups" aria-label="Sessions and artifacts">
				<section className="task-nav-group task-nav-sessions" aria-label="Sessions">
					<div className="section">
						Sessions
						<span className="sp" />
						{task.is_draft ? null : (
							<Link
								to="/"
								search={{ task: taskId }}
								className="section-act"
								aria-label="New session"
								title="New session"
								onClick={closeTaskSidebarOnNarrow}
							>
								<Plus className="i sm" />
							</Link>
						)}
					</div>
					<div className="task-nav-entries">
						{active.map((session) => (
							<WiredTaskSessionRow
								key={session.id}
								sessionId={session.id}
								selectedSessionId={sessionId}
							/>
						))}
						{active.length === 0 ? <div className="empty">No sessions yet</div> : null}
						{archived.length > 0 ? (
							<button
								type="button"
								className="row task-history"
								aria-expanded={showArchived}
								aria-label={`Archived sessions, ${archived.length}`}
								onClick={() => setShowArchived(!showArchived)}
							>
								<span className="t">Archived sessions</span>
								<span className="meta">{archived.length}</span>
							</button>
						) : null}
						{showArchived
							? archived.map((session) => (
									<WiredTaskSessionRow
										key={session.id}
										sessionId={session.id}
										selectedSessionId={sessionId}
									/>
								))
							: null}
					</div>
					<ResizeHandle pane="task-sessions" edge="bottom" />
				</section>
				<section className="task-nav-group" aria-label="Artifacts">
					<div className="section">Artifacts</div>
					<div className="task-nav-entries">
						{ordered.map((artifact) => (
							<ArtifactRow
								key={artifact.id}
								artifact={artifact}
								selected={navigation.search.artifactId === artifact.id}
								onOpen={() => {
									navigation.open(`artifact:${artifact.id}`)
									closeTaskSidebarOnNarrow()
								}}
							/>
						))}
						{ordered.length === 0 ? <div className="empty">No artifacts yet</div> : null}
					</div>
				</section>
				{canReview(task) ? (
					<section className="task-nav-group task-nav-views" aria-label="Task views">
						<button
							type="button"
							className={`row${navigation.search.view === 'changes' || navigation.search.diffFileId || navigation.search.diffCommentId ? ' sel' : ''}`}
							aria-current={navigation.search.view === 'changes' ? 'page' : undefined}
							onClick={() => {
								navigation.open('review')
								closeTaskSidebarOnNarrow()
							}}
						>
							<FileDiff className="i" strokeWidth={1.6} />
							<span className="t">Changes</span>
							<WiredDiffTotals task={task} />
						</button>
						<WiredPullRequestRow taskId={taskId} sessionId={sessionId} />
					</section>
				) : null}
			</nav>
			<ResizeHandle pane="task-nav" edge="right" />
		</aside>
	)
}

function WiredTaskSessionRow({ sessionId, selectedSessionId }: { sessionId: string; selectedSessionId?: string }) {
	const session = useSession(sessionId)
	const navigation = useTaskNavigation(session?.task_id ?? null, selectedSessionId)
	const unread = useUnreadStore((state) => state.unreadSessionIds.has(sessionId))
	const { closeTaskSidebarOnNarrow } = useUi()
	const anchor = useRef<HTMLButtonElement>(null)
	const [menu, setMenu] = useState(false)
	const [dialog, setDialog] = useState<SessionDialog | null>(null)
	if (!session) return null
	const main =
		sessionId === selectedSessionId &&
		!navigation.search.artifactId &&
		!navigation.search.view &&
		!navigation.search.diffFileId &&
		!navigation.search.diffCommentId
	const companion = sessionId === selectedSessionId && Boolean(navigation.search.artifactId) && !navigation.search.pr
	const name = sessionName(session)
	return (
		<>
			<button
				ref={anchor}
				type="button"
				className={`row${main ? ' sel' : ''}${companion ? ' companion' : ''}${unread ? ' unread' : ''}${session.archived ? ' archived' : ''}`}
				onContextMenu={(event) => {
					event.preventDefault()
					setMenu(true)
				}}
				aria-current={main ? 'page' : undefined}
				title={`${name} · ${statusAnnouncement(session.status)}${companion ? ' · Open in right panel' : ''}`}
				onClick={() => {
					navigation.selectSession(sessionId)
					closeTaskSidebarOnNarrow()
				}}
			>
				<span className="t">{name}</span>
				<span className="sr-only">
					, {statusAnnouncement(session.status)}
					{companion ? ', open in right panel' : ''}
					{unread ? ', unread' : ''}
				</span>
				<SessionMark status={session.status} unread={unread} phase={phaseOf(session)} />
			</button>
			{menu ? (
				<SessionRowMenu
					anchor={anchor}
					session={session}
					selected={sessionId === selectedSessionId}
					onClose={() => setMenu(false)}
					onDialog={setDialog}
				/>
			) : null}
			{dialog ? <SessionRowDialog dialog={dialog} session={session} onClose={() => setDialog(null)} /> : null}
		</>
	)
}

function SessionMark({
	status,
	unread,
	phase,
}: {
	status: Parameters<typeof isBusy>[0]
	unread: boolean
	phase: string | null
}) {
	if (isBusy(status)) return <span className="spin" />
	if (status === 'needs_approval') return <span className="dot warn" />
	if (status === 'failed' || status === 'lost') return <span className="dot err" />
	if (unread) return <span className="dot" />
	return <span className="meta">{phase}</span>
}

function WiredDiffTotals({ task }: { task: Task }) {
	// Outside a TaskDiffScope (a task that never settled) there is nothing to count.
	return use(TaskDiffContext) ? <DiffTotals task={task} /> : null
}

function DiffTotals({ task }: { task: Task }) {
	const totals = useDiffTotals(task)
	if (!totals) return null
	return (
		<span className="meta diff-totals">
			<span className="add">+{totals.added}</span>
			<span className="del">−{totals.removed}</span>
			<span className="sr-only">
				, {totals.added} lines added, {totals.removed} removed
			</span>
		</span>
	)
}

/**
 * The task name with a pencil after it. The pencil sticks to the last word so it never wraps onto
 * a line of its own, and opens the name for editing in place.
 */
function WiredTaskTitle({ taskId }: { taskId: string }) {
	const { task } = useTask(taskId)
	const [editing, setEditing] = useState(false)
	if (!task) return null
	const name = task.name ?? ''
	if (editing) return <TaskTitleEditor taskId={taskId} name={name} onDone={() => setEditing(false)} />
	const words = name.split(' ')
	const last = words.pop() ?? ''
	return (
		<div className="task-title">
			<h1 aria-label={name}>
				{words.length > 0 ? `${words.join(' ')} ` : null}
				<span className="task-title-end">
					{last}
					<button
						type="button"
						className="iconbtn task-rename"
						aria-label="Rename task"
						title="Rename task"
						onClick={() => setEditing(true)}
					>
						<Pencil className="i sm" />
					</button>
				</span>
			</h1>
		</div>
	)
}

/** The task name as a field that wraps like the title: Enter or leaving the field saves, Escape cancels. */
function TaskTitleEditor({ taskId, name, onDone }: { taskId: string; name: string; onDone: () => void }) {
	const { client: api } = useRiptideApi()
	const { showToast } = useUi()
	const [value, setValue] = useState(name)
	const [saving, setSaving] = useState(false)
	// Enter and the blur that follows can both ask to save in one render.
	const started = useRef(false)
	const save = async () => {
		const next = value.trim()
		if (started.current) return
		if (!next || next === name) return onDone()
		started.current = true
		setSaving(true)
		try {
			await api.tasks.update({ taskId, name: next })
			onDone()
		} catch {
			started.current = false
			setSaving(false)
			showToast('Could not rename the task. Your text is still here. Try again.')
		}
	}
	return (
		<div className="task-title">
			<textarea
				className="task-title-input"
				aria-label="Task name"
				rows={1}
				value={value}
				disabled={saving}
				autoFocus
				onFocus={(event) => {
					const end = event.currentTarget.value.length
					event.currentTarget.setSelectionRange(end, end)
				}}
				onChange={(event) => setValue(event.target.value.replace(/\n/g, ' '))}
				onBlur={() => void save()}
				onKeyDown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault()
						void save()
					} else if (event.key === 'Escape') {
						event.preventDefault()
						event.stopPropagation()
						onDone()
					}
				}}
			/>
		</div>
	)
}

/** Opens the PR panel. Shows the PR's number and its most urgent state once the task has a PR. */
function WiredPullRequestRow({ taskId, sessionId }: { taskId: string; sessionId?: string }) {
	const navigation = useTaskNavigation(taskId, sessionId)
	const { branch } = useTaskPullRequest(taskId)
	const { panelOpen, togglePanel, closeTaskSidebarOnNarrow } = useUi()
	const pr = branch?.pullRequest
	return (
		<button
			type="button"
			className={`row${navigation.search.pr ? ' sel' : ''}`}
			aria-pressed={Boolean(navigation.search.pr)}
			title={pr ? `${pr.title} · #${pr.number}` : undefined}
			onClick={() => {
				navigation.open('pr')
				if (!panelOpen) togglePanel()
				closeTaskSidebarOnNarrow()
			}}
		>
			<GitPullRequest className="i" strokeWidth={1.6} />
			<span className="t">{pr ? `Pull request #${pr.number}` : 'Pull requests'}</span>
			{branch && pr ? <WiredPullRequestBadge taskId={taskId} branch={branch} /> : null}
		</button>
	)
}

function WiredPullRequestBadge({
	taskId,
	branch,
}: {
	taskId: string
	branch: NonNullable<ReturnType<typeof useTaskPullRequest>['branch']>
}) {
	const live = usePrStatusStream({ scope: { taskId }, repoFullName: branch.repoFullName, branch: branch.branch })
	const pr = live.pullRequest ?? branch.pullRequest
	if (!pr) return null
	const badge = pullRequestBadge(pr, groupChecks(live.checks))
	return (
		<span className={`meta ${badge.tone}`}>
			<span className="sr-only">, </span>
			{badge.label}
		</span>
	)
}

/** An artifact in the outline: click opens it beside the thread, right-click opens its menu. */
function ArtifactRow({
	artifact,
	selected,
	onOpen,
}: {
	artifact: TaskArtifact
	selected: boolean
	onOpen: () => void
}) {
	const anchor = useRef<HTMLButtonElement>(null)
	const [menu, setMenu] = useState(false)
	return (
		<>
			<button
				ref={anchor}
				type="button"
				className={`row${selected ? ' sel' : ''}`}
				aria-current={selected ? 'page' : undefined}
				title={artifact.file_name}
				onClick={onOpen}
				onContextMenu={(event) => {
					event.preventDefault()
					setMenu(true)
				}}
			>
				{isImageArtifact(artifact) ? (
					<Image className="i" strokeWidth={1.6} />
				) : (
					<FileText className="i" strokeWidth={1.6} />
				)}
				<span className="t">{artifactName(artifact.file_name)}</span>
			</button>
			{menu ? <ArtifactRowMenu anchor={anchor} artifact={artifact} onClose={() => setMenu(false)} /> : null}
		</>
	)
}

/** Quick task actions under the title: auto-advance, and tools for the working directory. */
function WiredTaskTools({ taskId }: { taskId: string }) {
	const terminal = useTaskTerminal(taskId)
	const autoAdvance = useTaskAutoAdvance(taskId)
	const { directory } = terminal
	if (!directory && !autoAdvance.available) return null
	return (
		<div className="task-nav-tools" role="toolbar" aria-label="Task tools">
			{autoAdvance.available ? <AutoAdvanceButton {...autoAdvance} /> : null}
			{directory && isPtyAvailable() ? <TerminalButton open={terminal.open} onToggle={terminal.toggle} /> : null}
			{directory && !terminal.blocked ? <OpenInEditorButton directory={directory} /> : null}
			{directory ? <CopyDirectoryButton directory={directory} /> : null}
		</div>
	)
}

function AutoAdvanceButton({ on, handOffs, toggle }: { on: boolean; handOffs: string[]; toggle: () => void }) {
	return (
		<button
			type="button"
			className={`iconbtn auto-advance${on ? ' on' : ''}`}
			aria-label="Auto-advance"
			aria-pressed={on}
			title={`Auto-advance ${on ? 'on' : 'off'}: ${handOffs.join(', ')}`}
			onClick={toggle}
		>
			<SkipForward className="i" strokeWidth={1.6} fill="currentColor" />
		</button>
	)
}

function TerminalButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
	return (
		<button
			type="button"
			className={`iconbtn${open ? ' on' : ''}`}
			aria-label={open ? 'Hide terminal' : 'Show terminal'}
			aria-pressed={open}
			title={`${open ? 'Hide' : 'Show'} terminal ${shortcutHint('terminal')}`}
			onClick={onToggle}
		>
			<SquareTerminal className="i" strokeWidth={1.6} />
		</button>
	)
}

function OpenInEditorButton({ directory }: { directory: string }) {
	const { showToast } = useUi()
	const editor = useSettingsStore((state) => state.defaultEditor)
	return (
		<button
			type="button"
			className="iconbtn"
			aria-label="Open in editor"
			title="Open in editor"
			onClick={() =>
				void openInEditor({ path: directory, editor: editor === 'system' ? null : editor }).catch(() =>
					showToast(
						'Could not open the folder in your editor. Check that it is installed and the folder still exists.',
					),
				)
			}
		>
			<SquareArrowOutUpRight className="i" strokeWidth={1.6} />
		</button>
	)
}

function CopyDirectoryButton({ directory }: { directory: string }) {
	const copy = useCopy()
	return (
		<button
			type="button"
			className="iconbtn"
			aria-label="Copy working directory"
			title="Copy working directory"
			onClick={() => copy(directory, 'Path copied', 'Could not copy the path. Try again.')}
		>
			<Copy className="i" strokeWidth={1.6} />
		</button>
	)
}
