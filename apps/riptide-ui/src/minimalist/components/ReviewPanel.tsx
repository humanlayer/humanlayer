import type { Task } from '@humanlayer/db/tables/tasks'
import type { TaskDiffFileRowType } from '@humanlayer/streams/diff'
import { useDraftField } from '@humanlayer/ui/hooks/use-draft-field'
import {
	type DiffReviewComparison,
	getComparisonDiff,
	getDiffLineCounts,
} from '@humanlayer/ui/lib/diff-review/build-code-view-items'
import { diffCommentSideToPierre, pierreSideToDiffComment } from '@humanlayer/ui/lib/diff-review/diff-comment-anchor'
import type { AnnotationSide, DiffLineAnnotation, FileDiffOptions } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { Check, ChevronRight, GitBranch, MessageSquare, X } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'

import { useTaskDiffComparisons } from '@/hooks/diffs/useTaskDiffComparisons'
import { useTaskDiffFiles } from '@/hooks/diffs/useTaskDiffFiles'
import { useTaskDiffReviewedState } from '@/hooks/diffs/useTaskDiffReviewedState'
import { useTaskDiffVersions } from '@/hooks/diffs/useTaskDiffVersions'
import { type DiffComparison, taskDiffFileKey } from '@/hooks/stores/taskDiffReviewMarksStore'
import { Byline } from '@/minimalist/components/Avatar'
import { ChangedFileTree } from '@/minimalist/components/ChangedFileTree'
import { Segmented } from '@/minimalist/components/SettingsControls'
import { ShipActions } from '@/minimalist/components/ShipActions'
import { useMinimalistDark } from '@/minimalist/lib/color-scheme'
import { type DiffLinePoint, diffLineDraftKey, draftedDiffLines } from '@/minimalist/lib/comment-drafts'
import { taskBranch, useSession } from '@/minimalist/lib/data'
import {
	authorPerson,
	type DiffThread,
	diffCommentsMessage,
	fileThreads,
	lineThreads,
	threadFileId,
	threadOf,
	threadPlace,
	useDiffCommentWrites,
	useDiffThreads,
} from '@/minimalist/lib/diff-comments'
import { plural } from '@/minimalist/lib/format'
import { useAskAgent } from '@/minimalist/lib/send'
import { type PanelFocus, scrollOnce } from '@/minimalist/lib/thread-panel'

const MARK: Record<TaskDiffFileRowType['changeType'], string> = {
	modified: 'M',
	added: 'A',
	deleted: 'D',
	renamed: 'R',
}
/** Past this many files, each one starts folded so the panel reads as a list. */
const SCOPES: Array<{ value: 'task' | 'session'; label: string }> = [
	{ value: 'task', label: 'Whole task' },
	{ value: 'session', label: 'This session' },
]
/** What each file's diff starts from, shared with the standard review. */
const COMPARISONS: Array<{ value: DiffComparison; label: string }> = [
	{ value: 'since-last-review', label: 'Since last review' },
	{ value: 'since-task-start', label: 'Since task start' },
]

const FOLD_AFTER = 8

/** The task's total change as +N −M; opens Review. Hidden until there is a change. */
/** Lines added and removed across the task's changed files, or null before any file changes. Reads the TaskDiffScope. */
export function useDiffTotals(task: Task): { added: number; removed: number } | null {
	const files = useTaskDiffFiles(
		task.id,
		task.organization_id,
		task.workspace_id ?? null,
		task.workspace_state ?? null,
	)
	if (files.rows.length === 0) return null
	return {
		added: files.rows.reduce((sum, file) => sum + file.additions, 0),
		removed: files.rows.reduce((sum, file) => sum + file.deletions, 0),
	}
}

export function DiffStat({ task, onOpen }: { task: Task; onOpen: () => void }) {
	const totals = useDiffTotals(task)
	if (!totals) return null
	const { added, removed } = totals
	return (
		<button
			type="button"
			className="diffstat"
			title="Review changes"
			aria-label={`Review changes: ${added} lines added, ${removed} removed`}
			onClick={onOpen}
		>
			<span className="add">+{added}</span>
			<span className="del">−{removed}</span>
		</button>
	)
}

/**
 * Every change the task made, file by file, with line comments that go to the agent as one message.
 * Comments are saved on the task, so teammates see them and they outlast the panel.
 * Reads the task's diff streams, so it renders inside the thread's TaskDiffScope.
 */
export function ReviewPanel({
	task,
	sessionId,
	focus = null,
}: {
	task: Task
	sessionId: string | null
	/**
	 * A file to open and scroll to (a path from the transcript, or a diff file ID from a link),
	 * or a comment whose thread to show. Each new request scrolls again.
	 */
	focus?: PanelFocus | null
}) {
	const files = useTaskDiffFiles(
		task.id,
		task.organization_id,
		task.workspace_id ?? null,
		task.workspace_state ?? null,
	)
	const versions = useTaskDiffVersions(task.id, task.organization_id)
	const review = useTaskDiffReviewedState(task.id, files.rows)
	const { comparisons, omittedFileIds } = useTaskDiffComparisons(files.rows, versions, {
		comparison: review.comparison,
		reviewed: review.entries,
		unmarked: review.unmarkedEntries,
	})
	const agent = useAskAgent(sessionId)
	// Until the worktree exists there is no diff to load and nothing to commit.
	const settingUp = useSession(sessionId)?.status === 'waiting_for_workspace'
	const [scope, setScope] = useState<'task' | 'session'>('task')
	const [filter, setFilter] = useState('')
	const [selectedFile, setSelectedFile] = useState<string | null>(null)
	const [visitedFiles, setVisitedFiles] = useState<string[]>([])
	const [folded, setFolded] = useState<Record<string, boolean>>({})
	const { threads, loading: commentsLoading } = useDiffThreads(task.id, files.rows, comparisons)
	const writes = useDiffCommentWrites(task)
	const focusThread = focus?.comment ? threadOf(threads, focus.comment) : undefined
	const target = findTarget(files.rows, focusThread ? threadFileId(focusThread) : focus?.file)
	// Wait for everything that sets the list's height, or the scroll lands short.
	const settled = files.status !== 'loading' && versions.status !== 'loading' && !(focus?.comment && commentsLoading)
	const [handled, setHandled] = useState<typeof focus>(null)
	if (focus !== handled && settled) {
		setHandled(focus)
		if (target) {
			setSelectedFile(target.id)
			setFilter('')
			setScope('task')
			setFolded((current) => ({ ...current, [target.id]: false }))
		}
	}

	const comparisonOf = useMemo(
		() => new Map(comparisons.map((comparison) => [comparison.fileId, comparison] as const)),
		[comparisons],
	)
	const inSession = files.rows.some((file) => file.sessionId === sessionId)
	const multiSession = new Set(files.rows.map((file) => file.sessionId)).size > 1
	const shown = files.rows.filter(
		(file) =>
			(scope === 'task' || file.sessionId === sessionId) &&
			(!filter || file.path.toLowerCase().includes(filter.toLowerCase())),
	)
	const activeFile = shown.find((file) => file.id === selectedFile)?.id ?? shown[0]?.id
	if (activeFile && !visitedFiles.includes(activeFile)) setVisitedFiles([...visitedFiles, activeFile])
	const additions = shown.reduce((sum, file) => sum + file.additions, 0)
	const deletions = shown.reduce((sum, file) => sum + file.deletions, 0)
	const isViewed = (file: TaskDiffFileRowType) =>
		Boolean(file.versionId) && review.entries[taskDiffFileKey(file)]?.versionId === file.versionId
	const viewedCount = shown.filter(isViewed).length
	// The choice only matters once a file has been reviewed, so it stays out of the way until then.
	const reviewedBefore = Object.keys(review.entries).length + Object.keys(review.unmarkedEntries).length > 0
	const branch = taskBranch(task)

	// The linked thread, marked and scrolled to once everything above it has loaded.
	const focused = focus && focusThread && handled === focus ? { rootId: focusThread.root.id, request: focus } : null
	const missing = threads.filter((thread) => thread.placement.status === 'file-missing')
	const countOn = (file: TaskDiffFileRowType) =>
		threads.filter((thread) => 'fileId' in thread.placement && thread.placement.fileId === file.id).length

	// Sent threads resolve, so the next send and the agent's own comment lookup skip them.
	const sendComments = async () => {
		const message = diffCommentsMessage(threads)
		const sent = await agent.ask(message.text, {
			sent: 'Comments sent to the agent',
			queued: 'Comments queued. They send when the agent finishes.',
			failed: 'Could not send the comments. They are still open. Try again.',
		})
		if (sent) await writes.resolve(message.rootCommentIds)
	}

	const header = (
		<div className="phead review-head">
			{branch ? (
				<span className="branch" title={branch}>
					<GitBranch className="i sm" strokeWidth={1.6} />
					{branch}
				</span>
			) : null}
			<span className="sp" />
			{sessionId ? <ShipActions sessionId={sessionId} /> : null}
		</div>
	)

	if (settingUp && files.rows.length === 0)
		return <div className="empty pad">No changes yet. The workspace is still being set up.</div>

	if (files.status === 'unavailable') {
		return (
			<>
				{header}
				<div className="empty pad">
					{task.workspace_id || task.workspace_state
						? 'Could not load the changes. The host may be offline. They show up when it reconnects.'
						: 'Review works for tasks in a project or git worktree. This task runs in a plain directory.'}
				</div>
			</>
		)
	}
	if (files.status === 'loading') {
		return (
			<>
				{header}
				<div className="boot-mark" />
			</>
		)
	}

	return (
		<>
			{header}
			{files.rows.length === 0 ? (
				<div className="empty pad">No changes yet. Files the agent edits in this task show up here.</div>
			) : (
				<>
					<div className="review-bar">
						<span>
							{shown.length} {shown.length === 1 ? 'file' : 'files'}
							{' · '}
							<span className="add">+{additions}</span> <span className="del">−{deletions}</span>
							{viewedCount > 0 ? <span className="muted"> · {viewedCount} viewed</span> : null}
						</span>
						<span className="sp" />
						{multiSession && inSession ? (
							<Segmented label="Which changes" value={scope} options={SCOPES} onChange={setScope} />
						) : null}
						{reviewedBefore ? (
							<Segmented
								label="Compare files"
								value={review.comparison}
								options={COMPARISONS}
								onChange={review.setComparison}
							/>
						) : null}
						{files.rows.length > 5 ? (
							<input
								className="filter"
								placeholder="Filter files"
								aria-label="Filter files"
								value={filter}
								onChange={(event) => setFilter(event.target.value)}
							/>
						) : null}
					</div>
					{focus?.comment && handled === focus && !focusThread ? (
						<div className="rf-note">The linked comment is resolved or deleted.</div>
					) : null}
					<div className="changes-layout">
						<ChangedFileTree
							files={shown}
							selectedId={activeFile}
							isViewed={isViewed}
							commentCount={countOn}
							onSelect={(id) => {
								setSelectedFile(id)
								setFolded((current) => ({ ...current, [id]: false }))
							}}
						/>
						<div className="review-files">
							{shown.map((file) => {
								const viewed = isViewed(file)
								const open =
									folded[file.id] === undefined
										? !viewed && (file.id === activeFile || shown.length <= FOLD_AFTER)
										: !folded[file.id]
								const comparison = comparisonOf.get(file.id)
								return (
									<div key={file.id} hidden={file.id !== activeFile}>
										<ReviewFile
											key={file.id}
											file={file}
											comparison={comparison}
											open={open}
											viewed={viewed}
											commentCount={countOn(file)}
											scrollRequest={file === target && !focusThread ? handled : null}
											onToggle={() => setFolded((current) => ({ ...current, [file.id]: open }))}
											onViewed={(next) => {
												review.setReviewed(file, next)
												setFolded((current) => ({ ...current, [file.id]: next }))
											}}
										>
											{open || visitedFiles.includes(file.id) ? (
												<div hidden={!open}>
													<FilePatch
														task={task}
														file={file}
														comparison={comparison}
														omitted={omittedFileIds.has(file.id)}
														loading={versions.status === 'loading'}
														threads={threads}
														focused={focused}
													/>
												</div>
											) : null}
										</ReviewFile>
									</div>
								)
							})}
							{shown.length === 0 ? <div className="empty pad">No files match.</div> : null}
							{missing.length > 0 ? (
								<section className="rf" aria-label="Comments on files with no changes now">
									<div className="hunk">Comments on files with no changes now</div>
									{missing.map((thread) => (
										<ThreadCard
											key={thread.root.id}
											task={task}
											thread={thread}
											focus={thread === focusThread ? (focused?.request ?? null) : null}
										/>
									))}
								</section>
							) : null}
						</div>
					</div>
					{threads.length > 0 ? (
						<div className="review-send">
							<MessageSquare className="i sm" strokeWidth={1.6} />
							{plural(threads.length, 'open comment')}
							<span className="sp" />
							<button
								type="button"
								className="btn primary"
								onClick={() => void sendComments()}
								disabled={!sessionId || agent.pending}
							>
								{agent.running ? 'Queue for the agent' : 'Send to agent'}
							</button>
						</div>
					) : null}
				</>
			)}
		</>
	)
}

/**
 * The file a request names: a diff file ID from a link, or a path from the
 * transcript, which is absolute where diff rows are relative to the repository.
 */
function findTarget(files: readonly TaskDiffFileRowType[], name: string | undefined) {
	if (!name) return undefined
	return files.find((file) => name === file.id || name === file.path || name.endsWith(`/${file.path}`))
}

function ReviewFile({
	file,
	comparison,
	open,
	viewed,
	commentCount,
	scrollRequest,
	onToggle,
	onViewed,
	children,
}: {
	file: TaskDiffFileRowType
	comparison: DiffReviewComparison | undefined
	open: boolean
	viewed: boolean
	commentCount: number
	scrollRequest: PanelFocus | null
	onToggle: () => void
	onViewed: (viewed: boolean) => void
	/** The file's patch, while open. */
	children: ReactNode
}) {
	const slash = file.path.lastIndexOf('/')
	// Since your review, the counts are the change on screen rather than the whole task's.
	const sinceReview = comparison?.sourceVersionId ? getComparisonDiff(comparison) : null
	const counts = sinceReview ? getDiffLineCounts(sinceReview) : file
	return (
		<section
			className={`rf${viewed ? ' viewed' : ''}`}
			aria-label={file.path}
			ref={scrollOnce(scrollRequest, 'start')}
		>
			<div className="rf-h">
				<button
					type="button"
					className="rf-t"
					aria-expanded={open}
					onClick={onToggle}
					title={file.prevPath ? `${file.prevPath} → ${file.path}` : file.path}
				>
					<ChevronRight className={`i sm chev${open ? ' open' : ''}`} />
					<span className={`mark ${file.changeType}`} aria-label={file.changeType}>
						{MARK[file.changeType]}
					</span>
					<span className="path">
						<span className="dir">{file.path.slice(0, slash + 1)}</span>
						{file.path.slice(slash + 1)}
					</span>
					<span className="sp" />
					{commentCount > 0 ? <span className="ccount">{commentCount}</span> : null}
					{sinceReview ? <span className="muted">since your review</span> : null}
					<span className="add">+{counts.additions}</span>
					<span className="del">−{counts.deletions}</span>
				</button>
				<button
					type="button"
					className={`viewed-btn${viewed ? ' on' : ''}`}
					aria-pressed={viewed}
					onClick={() => onViewed(!viewed)}
					title={viewed ? 'Mark as not viewed' : 'Mark as viewed'}
				>
					<Check className="i sm" strokeWidth={2} />
					Viewed
				</button>
			</div>
			{children}
		</section>
	)
}

/** What sits under a diff line: a saved thread, or a comment you are writing. */
type LineNote = { kind: 'thread'; thread: DiffThread } | { kind: 'draft'; point: DiffLinePoint }

/** GitHub's palettes, matching the code colors in documents. */
const PATCH_THEME = { light: 'github-light', dark: 'github-dark' } as const
/** Pierre draws in its own shadow root; this trims its chrome to the panel's. */
const PATCH_CSS = `
	:host {
		--diffs-gap-block: 0px;
		--diffs-gap-fallback: 0px;
	}
	[data-code] {
		padding-top: 0 !important;
		padding-bottom: 2px !important;
	}
	[data-code] span {
		font-style: normal !important;
	}
	[data-separator-content],
	[data-separator-wrapper],
	[data-utility-button] {
		border-radius: 0 !important;
	}
	[data-utility-button] {
		background-color: var(--fg) !important;
		color: var(--bg) !important;
		border-radius: 4px !important;
	}
`

function FilePatch({
	task,
	file,
	comparison,
	omitted,
	loading,
	threads,
	focused,
}: {
	task: Task
	file: TaskDiffFileRowType
	/** The two versions this file's diff is between, once both have loaded. */
	comparison: DiffReviewComparison | undefined
	/** A version is too large to publish. */
	omitted: boolean
	loading: boolean
	/** The task's open threads; each shows under its line, or above the diff once its line is gone. */
	threads: readonly DiffThread[]
	/** A thread a link asked for, marked and scrolled to. */
	focused: { rootId: string; request: PanelFocus } | null
}) {
	const diff = useMemo(() => (comparison ? getComparisonDiff(comparison) : null), [comparison])
	const dark = useMinimalistDark()
	const writes = useDiffCommentWrites(task)
	const draftFile = { taskId: task.id, repoId: file.repoId, path: file.path }
	// Lines with a comment half written open again, without focus; the one you click takes it.
	const [composing, setComposing] = useState(() => ({
		points: draftedDiffLines(draftFile),
		opened: null as DiffLinePoint | null,
	}))
	const focusOf = (thread: DiffThread) => (thread.root.id === focused?.rootId ? focused.request : null)
	const above = fileThreads(threads, file.id).map((thread) => (
		<ThreadCard key={thread.root.id} task={task} thread={thread} focus={focusOf(thread)} />
	))
	const note = patchNote(file, comparison, omitted, loading, diff?.hunks.length ?? 0)
	if (note || !comparison || !diff)
		return (
			<>
				<div className="rf-note">{note}</div>
				{above}
			</>
		)

	const samePoint = (left: DiffLinePoint | null, right: DiffLinePoint) =>
		left?.side === right.side && left.line === right.line
	const open = (side: AnnotationSide, line: number) => {
		const point: DiffLinePoint = { side: pierreSideToDiffComment(side), line }
		setComposing(({ points }) => ({
			points: points.some((other) => samePoint(other, point)) ? points : [...points, point],
			opened: point,
		}))
	}
	const close = (point: DiffLinePoint) =>
		setComposing(({ points, opened }) => ({
			points: points.filter((other) => !samePoint(other, point)),
			opened: samePoint(opened, point) ? null : opened,
		}))
	const annotations: DiffLineAnnotation<LineNote>[] = [
		...lineThreads(threads, file.id).map(({ thread, side, line }) => ({
			side: diffCommentSideToPierre(side),
			lineNumber: line,
			metadata: { kind: 'thread', thread } as const,
		})),
		...composing.points.map((point) => ({
			side: diffCommentSideToPierre(point.side),
			lineNumber: point.line,
			metadata: { kind: 'draft', point } as const,
		})),
	]
	const options: FileDiffOptions<LineNote> = {
		theme: dark ? PATCH_THEME.dark : PATCH_THEME.light,
		themeType: dark ? 'dark' : 'light',
		diffStyle: 'unified',
		diffIndicators: 'classic',
		lineDiffType: 'word-alt',
		overflow: 'wrap',
		disableFileHeader: true,
		enableGutterUtility: true,
		onGutterUtilityClick: (range) => open(range.endSide ?? range.side ?? 'additions', range.end),
		onLineNumberClick: (line) => open(line.annotationSide, line.lineNumber),
		unsafeCSS: PATCH_CSS,
	}

	return (
		<div className="rf-body">
			{above}
			<FileDiff
				fileDiff={diff}
				// The shared worker pool colors code in the standard UI's theme, so this view colors its own.
				disableWorkerPool
				options={options}
				lineAnnotations={annotations}
				renderAnnotation={({ metadata }) => {
					// Pierre keys each slot by its place in the list, so the key here keeps a box's text with its line.
					if (metadata.kind === 'thread')
						return (
							<ThreadCard
								key={metadata.thread.root.id}
								task={task}
								thread={metadata.thread}
								focus={focusOf(metadata.thread)}
							/>
						)
					const { point } = metadata
					return (
						<DiffLineComposer
							key={`${point.side}:${point.line}`}
							draftKey={diffLineDraftKey(draftFile, point)}
							label={`Comment on line ${point.line}`}
							focus={samePoint(composing.opened, point)}
							onClose={() => close(point)}
							onSave={(text) => {
								close(point)
								return writes.add({ file, comparison, ...point }, text)
							}}
						/>
					)
				}}
			/>
		</div>
	)
}

/**
 * A comment being written on one diff line. Its text is a draft under `draftKey`, so it survives a
 * reload or a closed panel: Escape closes the box and keeps it, Discard throws it away.
 */
function DiffLineComposer({
	draftKey,
	label,
	focus,
	onSave,
	onClose,
}: {
	draftKey: string
	label: string
	/** You just opened it; a box that came back with its draft leaves focus where it is. */
	focus: boolean
	/** Resolves to whether the comment saved; the draft stays until it has. */
	onSave: (text: string) => Promise<boolean>
	onClose: () => void
}) {
	const draft = useDraftField(draftKey)
	// Seeded once; after that the box owns its text.
	const [text, setText] = useState(draft.value)
	const { clear } = draft
	return (
		<form
			className="lc edit"
			onSubmit={async (event) => {
				event.preventDefault()
				if (!text.trim()) return
				// onSave reports failures itself and never rejects.
				if (await onSave(text.trim())) clear()
			}}
		>
			<textarea
				autoFocus={focus}
				rows={2}
				aria-label={label}
				placeholder="What should change here"
				value={text}
				onChange={(event) => {
					setText(event.target.value)
					draft.setValue(event.target.value)
				}}
				onKeyDown={(event) => {
					if (event.key === 'Escape') onClose()
					if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
						event.currentTarget.form?.requestSubmit()
				}}
			/>
			<div className="acts">
				<button
					type="button"
					className="btn ghost"
					title={text.trim() ? 'Close and throw away what you wrote' : undefined}
					onClick={() => {
						draft.clear()
						onClose()
					}}
				>
					{text.trim() ? 'Discard' : 'Cancel'}
				</button>
				<button type="submit" className="btn primary" disabled={!text.trim()}>
					Add comment
				</button>
			</div>
		</form>
	)
}

/** Why a file shows a note in place of its lines, if it does. */
function patchNote(
	file: TaskDiffFileRowType,
	comparison: DiffReviewComparison | undefined,
	omitted: boolean,
	loading: boolean,
	hunkCount: number,
): string | null {
	if (file.binary) return 'Binary file'
	if (omitted) return 'This diff is too large to show here.'
	if (!comparison) return loading ? 'Loading…' : 'The diff for this file is not available yet.'
	if (hunkCount > 0) return null
	if (file.changeType === 'added') return 'Empty file'
	if (file.changeType === 'renamed') return 'Renamed with no line changes'
	return 'No line changes'
}

/** One saved thread: who said what, then resolve, or delete when it's yours. */
function ThreadCard({
	task,
	thread,
	focus,
}: {
	task: Task
	thread: DiffThread
	/** The link request that names this thread, if one does. */
	focus: PanelFocus | null
}) {
	const writes = useDiffCommentWrites(task)
	const place = threadPlace(thread)
	return (
		<div className={`lc${focus ? ' on' : ''}`} ref={scrollOnce(focus, 'center')}>
			<div className="lc-t">
				{place ? <div className="lc-w">{place}</div> : null}
				{[thread.root, ...thread.replies].map((comment) => (
					<div key={comment.id} className="lc-c">
						<Byline {...authorPerson(comment)} size={16} />
						<div className="lc-x">
							{comment.is_deleted ? <span className="muted">Comment deleted</span> : comment.content_text}
						</div>
					</div>
				))}
			</div>
			<button
				type="button"
				className="iconbtn"
				aria-label="Resolve comment"
				title="Resolve"
				onClick={() => void writes.resolve([thread.root.id])}
			>
				<Check className="i sm" />
			</button>
			{thread.root.created_by_user_id === writes.userId ? (
				<button
					type="button"
					className="iconbtn"
					aria-label="Delete comment"
					title="Delete"
					onClick={() => void writes.remove(thread.root.id)}
				>
					<X className="i sm" />
				</button>
			) : null}
		</div>
	)
}
