import { eq, useLiveQuery } from '@tanstack/react-db'
import { Check, ChevronDown, ChevronRight, FileText, GitFork, MessageSquare } from 'lucide-react'
import { useState } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useArtifactContent } from '@/hooks/live-queries/useArtifactContent'
import { useTaskArtifactUrl } from '@/hooks/useTaskArtifactUrl'
import { Avatar, WiredUserAvatar } from '@/minimalist/components/Avatar'
import { CopyButton } from '@/minimalist/components/CopyButton'
import { StepGlyph } from '@/minimalist/components/icons'
import { Prose } from '@/minimalist/components/Prose'
import { StepList } from '@/minimalist/components/Steps'
import { parseCommentMessage } from '@/minimalist/lib/artifact-comments'
import { artifactName, docKind, wordCount } from '@/minimalist/lib/artifacts'
import { isImage, splitAttachments } from '@/minimalist/lib/attachments'
import { canReview, useTask, useTaskArtifacts } from '@/minimalist/lib/data'
import { parseDiffCommentMessage } from '@/minimalist/lib/diff-comments'
import { commonDir, formatClock, formatDuration, plural } from '@/minimalist/lib/format'
import type { PanelTab } from '@/minimalist/lib/thread-panel'
import { type FileEdits, latestTodos, type TodoItem, turnWrites } from '@/minimalist/lib/tools'
import type { Turn } from '@/minimalist/lib/transcript'

export function Transcript({
	turns,
	running,
	onFork,
	taskId,
	onOpen,
	multiplayer = false,
}: {
	turns: Turn[]
	running: boolean
	onFork?: (turn: { id: string; text: string }) => void
	/** Set inside a task, where edit and document cards open their side panel tab. */
	taskId?: string | null
	onOpen?: (tab: PanelTab, file?: string) => void
	multiplayer?: boolean
}) {
	const firstUser = turns.findIndex((turn) => turn.kind === 'user')
	const { task } = useTask(taskId)
	const reviewable = task !== null && canReview(task)
	return (
		<>
			{turns.map((turn, index) => {
				if (turn.kind === 'user')
					return (
						<UserTurn
							key={turn.id}
							turn={turn}
							multiplayer={multiplayer}
							taskId={taskId}
							onFork={index > firstUser ? onFork : undefined}
						/>
					)
				if (turn.kind === 'compaction')
					return (
						<div key={turn.id} className="compact-divider">
							Earlier messages summarized to save context
						</div>
					)
				const live = running && index === turns.length - 1
				return (
					<AgentTurn
						key={turn.id}
						turn={turn}
						live={live}
						taskId={taskId}
						reviewable={reviewable}
						onOpen={onOpen}
					/>
				)
			})}
			{running && turns.at(-1)?.kind !== 'agent' ? (
				<div className="worked flush">
					<span className="spin" /> Starting…
				</div>
			) : null}
		</>
	)
}

function UserTurn({
	turn,
	taskId,
	onFork,
	multiplayer,
}: {
	turn: Extract<Turn, { kind: 'user' }>
	taskId?: string | null
	onFork?: (turn: { id: string; text: string }) => void
	multiplayer: boolean
}) {
	return (
		<div className="turn-user">
			{multiplayer ? (
				turn.userId ? (
					<WiredUserAvatar userId={turn.userId} size={24} />
				) : (
					<Avatar name={turn.author ?? 'Unknown member'} size={24} />
				)
			) : null}
			<div className="msg">
				<MessageBody text={turn.text} taskId={taskId} />
				<div className="turn-actions hover-reveal">
					{onFork ? (
						<button
							type="button"
							title="Fork from this message"
							aria-label="Fork from this message"
							onClick={() => onFork(turn)}
						>
							<GitFork className="i sm" />
						</button>
					) : null}
					<CopyButton label="Copy message" text={() => turn.text} />
					<span className="stamp">
						{turn.author ? `${turn.author} · ` : ''}
						{formatClock(turn.at)}
					</span>
				</div>
			</div>
		</div>
	)
}

/** Comments sent from a document or the diff read as a short list, not the XML the agent receives. */
function MessageBody({ text, taskId }: { text: string; taskId?: string | null }) {
	const sent = parseCommentMessage(text) ?? parseDiffCommentMessage(text)
	if (!sent) {
		const message = splitAttachments(text)
		return (
			<>
				{message.files.length > 0 ? (
					<div className="sent-files">
						{message.files.map((fileName) => (
							<SentFile key={fileName} taskId={taskId} fileName={fileName} />
						))}
					</div>
				) : null}
				{message.text ? <div className="bubble">{message.text}</div> : null}
			</>
		)
	}
	return (
		<div className="bubble sent-comments">
			<div className="lbl">
				<MessageSquare className="i sm" strokeWidth={1.6} />
				{plural(sent.comments.length, 'comment')}
				{sent.file ? ` on ${sent.file}` : ''}
			</div>
			{sent.comments.map((comment, index) => (
				<div key={index} className="sc">
					{comment.quote ? <div className="q">{comment.quote}</div> : null}
					{comment.lines.map((line, row) => (
						<div key={row}>{line}</div>
					))}
				</div>
			))}
		</div>
	)
}

/** An attached file: images as a thumbnail that opens full size, anything else by name. */
function SentFile({ taskId, fileName }: { taskId?: string | null; fileName: string }) {
	const { url } = useTaskArtifactUrl({ taskId: taskId ?? undefined, fileName })
	const name = artifactName(fileName)
	if (isImage(fileName) && url) {
		return (
			<a className="sent-image" href={url} target="_blank" rel="noreferrer" title={name}>
				<img src={url} alt={name} />
			</a>
		)
	}
	return (
		<a className="attachment" href={url} target="_blank" rel="noreferrer" title={name}>
			<FileText className="i sm" strokeWidth={1.6} />
			<span>{name}</span>
		</a>
	)
}

function AgentTurn({
	turn,
	live,
	taskId,
	reviewable,
	onOpen,
}: {
	turn: Extract<Turn, { kind: 'agent' }>
	live: boolean
	taskId?: string | null
	/** Whether the task has a Review tab for the edits card to open. */
	reviewable: boolean
	onOpen?: (tab: PanelTab, file?: string) => void
}) {
	const waiting = turn.steps.some((step) => step.kind === 'tool' && step.approvalStatus === 'pending')
	const [open, setOpen] = useState<boolean | null>(null)
	const isOpen = open ?? (live || waiting)
	const elapsed = (live ? Date.now() : turn.endedAt) - turn.startedAt
	const duration = elapsed < 1000 ? 'a moment' : formatDuration(elapsed)
	const todos = latestTodos(turn.steps)
	const { docs, files } = turnWrites(turn.steps)
	return (
		<div className="agent-turn">
			{turn.steps.length > 0 ? (
				<button type="button" className="worked" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}>
					{live ? `Working for ${duration}` : `Worked for ${duration}`}
					{isOpen ? <ChevronDown className="i sm" /> : <ChevronRight className="i sm" />}
				</button>
			) : null}
			{isOpen ? (
				<div className="steps">
					<StepList steps={turn.steps} />
				</div>
			) : null}
			{todos.length > 0 && (live || !isOpen) ? <TodoCard todos={todos} /> : null}
			{turn.answer ? <Prose text={turn.answer} /> : null}
			{!live && taskId && onOpen
				? docs.map((fileName) => <DocCard key={fileName} taskId={taskId} fileName={fileName} onOpen={onOpen} />)
				: null}
			{!live && files.length > 0 ? (
				<EditsSummary
					files={files}
					onReview={onOpen && reviewable ? (file) => onOpen('review', file) : undefined}
				/>
			) : null}
			{!live && turn.answer ? (
				<div className="turn-actions hover-reveal">
					<CopyButton label="Copy response" text={() => turn.answer ?? ''} />
					<span className="stamp">{formatClock(turn.endedAt)}</span>
				</div>
			) : null}
		</div>
	)
}

const LISTED_FILES = 4

/** What the turn changed: totals, then each file, which opens Review scrolled to it. */
function EditsSummary({ files: rows, onReview }: { files: FileEdits[]; onReview?: (file?: string) => void }) {
	const totals = rows.reduce((acc, row) => ({ added: acc.added + row.added, removed: acc.removed + row.removed }), {
		added: 0,
		removed: 0,
	})
	if (totals.added === 0 && totals.removed === 0) return null
	// Past the limit, the last row counts the rest; a single leftover file just gets its own row.
	const listed = rows.length > LISTED_FILES + 1 ? LISTED_FILES : rows.length
	const root = commonDir(rows.map((row) => row.path))
	// One file needs no list: the header names it and Review opens on it.
	const only = rows.length === 1 ? rows[0]?.path : undefined
	return (
		<div className="diffcard edits">
			<div className="h">
				<StepGlyph icon="file" />
				<b className="ell" title={only}>
					Edited {only ? only.split('/').at(-1) : plural(rows.length, 'file')}
				</b>
				<span className="add">+{totals.added}</span>
				<span className="del">−{totals.removed}</span>
				{onReview ? (
					<button type="button" className="btn ghost review-link" onClick={() => onReview(only)}>
						Review
					</button>
				) : null}
			</div>
			{rows.slice(0, only ? 0 : listed).map(({ path, added, removed }) => {
				const relative = path.slice(root.length)
				const slash = relative.lastIndexOf('/')
				const row = (
					<>
						<span className="ell">
							{relative.slice(slash + 1)}
							{slash > 0 ? <span className="muted"> {relative.slice(0, slash)}</span> : null}
						</span>
						<span className="add">+{added}</span>
						<span className="del">−{removed}</span>
					</>
				)
				return onReview ? (
					<button key={path} type="button" className="ef" title={path} onClick={() => onReview(path)}>
						{row}
					</button>
				) : (
					<div key={path} className="ef" title={path}>
						{row}
					</div>
				)
			})}
			{listed < rows.length ? (
				onReview ? (
					<button type="button" className="ef muted" onClick={() => onReview()}>
						{plural(rows.length - listed, 'more file')}
					</button>
				) : (
					<div className="ef muted">{plural(rows.length - listed, 'more file')}</div>
				)
			) : null}
		</div>
	)
}

/** A document the agent wrote this turn, with enough to decide whether to open it. */
function DocCard({ taskId, fileName, onOpen }: { taskId: string; fileName: string; onOpen: (tab: PanelTab) => void }) {
	const artifact = useTaskArtifacts(taskId).find((row) => row.file_name === fileName)
	const content = useArtifactContent(artifact?.id ?? null).artifact?.content ?? ''
	const { artifactCommentsCollection: comments } = useSync()
	const { data } = useLiveQuery(
		(q) =>
			artifact ? q.from({ comments }).where(({ comments }) => eq(comments.artifact_id, artifact.id)) : undefined,
		[comments, artifact?.id],
	)
	if (!artifact) return null
	const open = (data ?? []).filter((row) => !row.is_deleted && !row.is_resolved && !row.reply_to_comment_id).length
	const words = wordCount(content)
	const facts = [
		docKind(fileName),
		words ? `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}` : null,
		open ? plural(open, 'comment') : null,
	]
	return (
		<button type="button" className="doccard" onClick={() => onOpen(`artifact:${artifact.id}`)}>
			<FileText className="i" strokeWidth={1.6} />
			<span className="t">
				<b>{artifactName(fileName)}</b>
				<span className="muted">{facts.filter(Boolean).join(' · ')}</span>
			</span>
			<span className="btn">Open</span>
		</button>
	)
}

function TodoCard({ todos }: { todos: TodoItem[] }) {
	const done = todos.filter((todo) => todo.status === 'completed').length
	return (
		<div className="todo">
			<div className="h">
				Plan · {done} of {todos.length} done
			</div>
			{todos.map((todo, index) => (
				<div key={index} className="it">
					{todo.status === 'completed' ? (
						<span className="box done">
							<Check strokeWidth={3} />
						</span>
					) : todo.status === 'in_progress' ? (
						<span className="spin" />
					) : (
						<span className="box" />
					)}
					<span className={todo.status === 'completed' ? 'done-t' : undefined}>{todo.content}</span>
					{todo.status === 'pending' ? null : (
						<span className="sr-only">, {todo.status === 'completed' ? 'done' : 'in progress'}</span>
					)}
				</div>
			))}
		</div>
	)
}
