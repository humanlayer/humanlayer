import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import type { Task } from '@humanlayer/db/tables/tasks'
import type { AnchorV2 } from '@humanlayer/ui/artifact-viewer-v2'
import { draftSessionStorageKeys } from '@humanlayer/ui/lib/draft-session-storage-keys'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronUp, Copy, History, ListTree, MessageSquarePlus } from 'lucide-react'
import { Fragment, type MouseEvent, type ReactNode, type TouchEvent, useMemo, useRef, useState } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { artifactDownloadUrlQueryOptions } from '@/hooks/live-queries/artifact-download-url-query'
import { useArtifactContent } from '@/hooks/live-queries/useArtifactContent'
import { useHtmlArtifactDocument } from '@/hooks/live-queries/useHtmlArtifactDocument'
import type { TaskArtifact } from '@/hooks/live-queries/useTaskArtifacts'
import { useMountEffect } from '@/hooks/useMountEffect'
import { ArtifactShare } from '@/minimalist/components/ArtifactShare'
import {
	CommentBox,
	type DocContext,
	ResolvedThreads,
	ThreadCard,
	UNSAVED_COMMENT,
} from '@/minimalist/components/DocThread'
import { Menu, MenuItem } from '@/minimalist/components/Menu'
import { Prose } from '@/minimalist/components/Prose'
import { commentsMessage, documentThreads, isClosedComment, threadOf } from '@/minimalist/lib/artifact-comments'
import {
	artifactName,
	body,
	docKind,
	type Heading,
	headingsOf,
	isHtmlArtifact,
	isImageArtifact,
	plainText,
	splitBlocks,
} from '@/minimalist/lib/artifacts'
import { documentDraftTargetKey, useStoredTarget } from '@/minimalist/lib/comment-drafts'
import { markSpans } from '@/minimalist/lib/comment-marks'
import { useSession } from '@/minimalist/lib/data'
import { anchorSpan, docBlocks, rangeAnchor, topBlockAnchor } from '@/minimalist/lib/doc-anchors'
import { type DocChanges, diffBlocks } from '@/minimalist/lib/doc-diff'
import { type DocHistory, useDocHistory } from '@/minimalist/lib/doc-history'
import { type DocSelection, readSelection } from '@/minimalist/lib/doc-selection'
import { formatAgo, plural, toMs } from '@/minimalist/lib/format'
import { useAskAgent } from '@/minimalist/lib/send'
import { sessionName } from '@/minimalist/lib/session-name'
import type { PanelFocus } from '@/minimalist/lib/thread-panel'
import { useUi } from '@/minimalist/lib/ui-state'
import { useCopy } from '@/minimalist/lib/use-copy'
import { useCommentAuthor, useDocComments } from '@/minimalist/lib/use-doc-comments'
import { useRiptideApi } from '@/orpc/client'

/** Where you were in each document, so leaving for another tab and coming back keeps your place. */
const readingAt = new Map<string, number>()

/**
 * A ref for the document that returns to where you were, once its text is there. A link that
 * names a comment scrolls to that instead.
 */
function keepPlace(artifactId: string, ready: boolean) {
	return (doc: HTMLDivElement | null) => {
		const at = readingAt.get(artifactId)
		if (doc && ready && at !== undefined) doc.scrollTop = at
	}
}

/**
 * Text you selected in the document and where its Comment button floats, read when a press or touch
 * ends. Nothing is picked while an older version shows, since it takes no comments.
 */
function usePicked(disabled: boolean) {
	const [picked, setPicked] = useState<Picked | null>(null)
	const pick = (event: MouseEvent<HTMLDivElement> | TouchEvent<HTMLDivElement>) => {
		const selection = disabled ? null : readSelection(window.getSelection())
		const range = selection ? window.getSelection()?.getRangeAt(0).getBoundingClientRect() : undefined
		if (!selection || !range) return setPicked(null)
		const box = event.currentTarget.getBoundingClientRect()
		setPicked({
			selection,
			x: range.left + range.width / 2 - box.left,
			y: range.top - box.top + event.currentTarget.scrollTop,
		})
	}
	return { picked, pick, clearPick: () => setPicked(null) }
}

/**
 * A comment being written: the block it will sit under, what it anchors to, and the words you picked.
 * It is kept in sessionStorage with its text, so the box opens again after a reload or a route change.
 */
type Draft = { block: number; anchor: AnchorV2; quote: string | null }

/** Text you selected, and where its Comment button floats in the document. */
type Picked = { selection: DocSelection; x: number; y: number }

/** One artifact: an image or web page the agent saved, or a document you can comment on. Children end its header row. */
export function ArtifactView(props: {
	task: Task
	artifact: TaskArtifact
	sessionId: string | null
	focus?: PanelFocus
	children?: ReactNode
}) {
	if (isImageArtifact(props.artifact)) return <ImageView artifact={props.artifact}>{props.children}</ImageView>
	if (isHtmlArtifact(props.artifact)) return <HtmlView artifact={props.artifact}>{props.children}</HtmlView>
	return <DocumentView {...props} />
}

/** An image artifact, fetched through the same signed download link the standard viewer uses. */
function ImageView({ artifact, children }: { artifact: TaskArtifact; children?: ReactNode }) {
	const { queryClient: api } = useRiptideApi()
	const { data, isLoading, isError } = useQuery({
		...artifactDownloadUrlQueryOptions(api, { id: artifact.id, last_updated_at: artifact.last_updated_at ?? 0n }),
		staleTime: 4 * 60 * 60 * 1000,
		retry: false,
	})
	const name = artifactName(artifact.file_name)
	return (
		<>
			<div className="phead">
				<span className="title ell">{name}</span>
				<span className="sp" />
				{data?.downloadUrl ? (
					<a className="btn ghost sm" href={data.downloadUrl} target="_blank" rel="noreferrer">
						Open original
					</a>
				) : null}
				{children}
			</div>
			<div className="doc image-artifact">
				{isLoading ? <div className="boot-mark" /> : null}
				{isError ? (
					<div className="empty pad">Could not load this image. Reload the page to try again.</div>
				) : null}
				{data?.downloadUrl ? <img src={data.downloadUrl} alt={name} /> : null}
			</div>
		</>
	)
}

/**
 * A web page the agent saved, run in a sandboxed frame as the standard viewer runs it. A page stored as a
 * file loads from its signed link, with links to the task's other files pointed at theirs; one stored as
 * text loads from that text.
 */
function HtmlView({ artifact, children }: { artifact: TaskArtifact; children?: ReactNode }) {
	const { queryClient: api } = useRiptideApi()
	const { artifact: stored, isLoading: loadingStored } = useArtifactContent(artifact.id)
	const inS3 = stored?.storage_type === 's3'
	const download = useQuery({
		...artifactDownloadUrlQueryOptions(api, { id: artifact.id, last_updated_at: artifact.last_updated_at ?? 0n }),
		enabled: inS3,
		staleTime: 4 * 60 * 60 * 1000,
		retry: false,
	})
	const url = download.data?.downloadUrl
	const rewritten = useHtmlArtifactDocument({
		artifactId: artifact.id,
		fileName: artifact.file_name,
		imageUrl: url,
		storageType: stored?.storage_type,
		iframeRenderKey: artifact.last_updated_at?.toString(),
	})
	const text = !inS3 && stored?.content ? stored.content : undefined
	const name = artifactName(artifact.file_name)
	return (
		<>
			<div className="phead">
				<span className="title ell">{name}</span>
				<span className="sp" />
				{url ? (
					<a className="btn ghost sm" href={url} target="_blank" rel="noreferrer">
						Open original
					</a>
				) : null}
				{children}
			</div>
			<div className="html-artifact">
				{loadingStored || download.isLoading ? <div className="boot-mark" /> : null}
				{download.isError ? (
					<div className="empty pad">Could not load this page. Reload the page to try again.</div>
				) : null}
				{rewritten || text || url ? (
					// A srcDoc, when there is one, wins over the src.
					<iframe
						key={artifact.last_updated_at?.toString()}
						src={url}
						srcDoc={rewritten ?? text}
						title={name}
						sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
					/>
				) : null}
			</div>
		</>
	)
}

/**
 * One document you can comment on: select any words, or use a block's
 * comment button. Threads sit under the block they are about.
 */
function DocumentView({
	task,
	artifact: active,
	sessionId,
	focus,
	children,
}: {
	task: Task
	artifact: TaskArtifact
	/** Where "Send to agent" posts the comments. */
	sessionId: string | null
	/** A link naming a comment: its thread scrolls into view once, marked. */
	focus?: PanelFocus
	children?: ReactNode
}) {
	const { artifact, isLoading } = useArtifactContent(active.id)
	const taskId = task.id
	const { artifactCommentsCollection: comments } = useSync()
	const actions = useDocComments(task, active.id)
	const authorOf = useCommentAuthor()
	const agent = useAskAgent(sessionId)
	const targetSession = useSession(sessionId)
	const copy = useCopy()
	const { showToast } = useUi()
	const [draft, setDraft] = useStoredTarget<Draft>(documentDraftTargetKey(active.id))
	// Set when you open the box; a box that came back with its draft leaves focus where it is.
	const [opened, setOpened] = useState(false)
	const openDraft = (next: Draft) => {
		setDraft(next)
		setOpened(true)
	}
	const history = useDocHistory(active.id)
	const { picked, pick, clearPick } = usePicked(history.readingId !== null)
	// An older version reads like the latest one, without the comment controls.
	const viewingOld = history.readingId !== null
	const content = viewingOld ? (history.old?.content ?? '') : (artifact?.content ?? '')
	const blocks = useMemo(() => splitBlocks(body(content)), [content])
	const texts = blocks.map(plainText)
	const headings = headingsOf(blocks)
	// Parsing every block again is the costly part, so it waits for the text to change.
	const anchors = useMemo(() => docBlocks(blocks), [blocks])
	const { comparing, baseContent } = history
	const changes = useMemo(
		() =>
			comparing && !viewingOld && baseContent !== undefined
				? diffBlocks(splitBlocks(body(baseContent)), blocks)
				: null,
		[comparing, viewingOld, baseContent, blocks],
	)

	const commentsQuery = useLiveQuery(
		(q) => q.from({ comments }).where(({ comments }) => eq(comments.artifact_id, active.id)),
		[comments, active.id],
	)
	const rows = (commentsQuery.data ?? []) as ArtifactComment[]
	const { open, resolved, byBlock } = documentThreads(rows, anchors, texts)
	const linked = focus?.comment
	// Until the text arrives every thread looks orphaned; placing the link then would scroll to the wrong spot.
	const focused = linked && content ? threadOf(open, linked) : undefined
	const closed = linked !== undefined && !commentsQuery.isLoading && isClosedComment(rows, linked)
	const doc: DocContext = { task, artifactId: active.id, fileName: active.file_name, sessionId }
	// The words open threads are about, and the ones you picked for the comment you are writing.
	const drafted = draft?.quote ? anchorSpan(anchors, draft.anchor) : null
	const spans = viewingOld ? [] : [...open.map((thread) => thread.span), drafted].flatMap((span) => span ?? [])

	const commentOnSelection = () => {
		// Touch screens let you drag the selection's ends after the button shows, so read it again.
		const selection = (viewingOld ? null : readSelection(window.getSelection())) ?? picked?.selection
		if (!selection) return
		const anchor = rangeAnchor(anchors, selection.start, selection.end)
		clearPick()
		window.getSelection()?.removeAllRanges()
		if (anchor) openDraft({ block: selection.end.top, anchor, quote: anchor.selectedText })
		else showToast('Could not comment on that selection. Select words in the text instead.')
	}
	const commentOnBlock = (index: number) => {
		const anchor = topBlockAnchor(anchors, index)
		if (anchor) openDraft({ block: index, anchor, quote: null })
	}
	const save = (text: string) => {
		if (!draft) return false
		if (actions.create(draft.anchor, text)) {
			setDraft(null)
			return true
		}
		showToast(UNSAVED_COMMENT)
		return false
	}
	const sendAll = async () => {
		const sent = await agent.ask(commentsMessage(active.file_name, open, authorOf), {
			sent: `Sent ${plural(open.length, 'comment')} to the agent`,
			queued: `${plural(open.length, 'comment')} queued. They send when the agent finishes.`,
			failed: 'Could not send the comments. They are still here.',
		})
		if (sent) actions.resolveSent(open.map((thread) => thread.root.id))
	}

	// Kind, age and version sit under the document's title, where a reader looks for them.
	const titled = /^#\s/.test(blocks[0] ?? '')
	const meta = content || history.old ? <DocMeta artifact={active} history={history} changes={changes} /> : null
	const orphans = byBlock.get(-1) ?? []

	return (
		<>
			<div className="phead">
				<Outline headings={headings} scope={active.id} />
				<span className="sp" />
				{targetSession ? (
					<span className="meta comment-target" title={sessionName(targetSession)}>
						Send to {sessionName(targetSession)}
					</span>
				) : (
					<Link className="btn ghost sm comment-target" to="/" search={{ task: task.id }}>
						New session to send comments
					</Link>
				)}
				{open.length > 0 && !viewingOld ? (
					<button
						type="button"
						className="btn primary sm"
						disabled={!sessionId || agent.pending}
						onClick={() => void sendAll()}
					>
						Send {plural(open.length, 'comment')} to the agent
					</button>
				) : null}
				{history.versions && history.versions.archived.length > 0 ? (
					<Versions versions={history.versions} selected={history.readingId} onSelect={history.read} />
				) : null}
				<ArtifactShare artifactId={active.id} taskId={taskId} />
				<button
					type="button"
					className="iconbtn"
					disabled={!content}
					title="Copy markdown"
					aria-label="Copy markdown"
					onClick={() =>
						copy(
							content,
							'Markdown copied',
							'Could not copy the markdown. Select the text and copy it by hand.',
						)
					}
				>
					<Copy className="i sm" strokeWidth={1.6} />
				</button>
				{children}
			</div>
			<div
				className="doc"
				onMouseUp={pick}
				onTouchEnd={pick}
				onScroll={(event) => readingAt.set(active.id, event.currentTarget.scrollTop)}
				ref={mergeRefs(markSpans(spans), keepPlace(active.id, Boolean(content) && !linked && !viewingOld))}
			>
				<OutlineRail headings={headings} scope={active.id} />
				{picked ? (
					<button
						type="button"
						className="doc-pick"
						style={{ left: picked.x, top: picked.y }}
						// Keep the selection while the press lands.
						onMouseDown={(event) => event.preventDefault()}
						onMouseUp={(event) => event.stopPropagation()}
						onTouchEnd={(event) => event.stopPropagation()}
						onClick={commentOnSelection}
					>
						<MessageSquarePlus className="i sm" strokeWidth={1.6} /> Comment
					</button>
				) : null}
				{closed && !viewingOld ? (
					<div className="doc-note">The linked comment is resolved or deleted.</div>
				) : null}
				{history.oldFailed ? (
					<div className="doc-note">
						Could not load this version.{' '}
						<button type="button" className="linkbtn" onClick={() => history.read(null)}>
							Back to latest
						</button>
					</div>
				) : null}
				{isLoading || history.oldLoading ? <div className="boot-mark" /> : null}
				{titled ? null : meta}
				{blocks.map((block, index) => (
					<Fragment key={index}>
						<RemovedBlocks blocks={changes?.removed.get(index)} />
						<div
							id={`${active.id}-${index}`}
							data-block={index}
							className={[
								'ablock',
								!viewingOld && draft?.block === index ? 'composing' : '',
								changes?.marks.get(index) ?? '',
							]
								.filter(Boolean)
								.join(' ')}
						>
							<Prose text={block} />
							{texts[index] && !viewingOld ? (
								<button
									type="button"
									className="ablock-add"
									title="Comment"
									aria-label="Comment on this block"
									onClick={() => commentOnBlock(index)}
								>
									<MessageSquarePlus className="i sm" strokeWidth={1.6} />
								</button>
							) : null}
							{(viewingOld ? [] : (byBlock.get(index) ?? [])).map((thread) => (
								<ThreadCard
									key={thread.root.id}
									thread={thread}
									doc={doc}
									focus={thread === focused ? focus : undefined}
								/>
							))}
							{!viewingOld && draft?.block === index ? (
								<CommentBox
									placeholder="Comment"
									action="Comment"
									quote={draft.quote}
									draftKey={draftSessionStorageKeys.newComment(active.id)}
									focus={opened}
									onClose={() => setDraft(null)}
									onSave={save}
								/>
							) : null}
						</div>
						{index === 0 && titled ? meta : null}
					</Fragment>
				))}
				<RemovedBlocks blocks={changes?.removed.get(blocks.length)} />
				{changes ? (
					<ChangeSteps
						count={changes.marks.size + changes.removed.size}
						onDone={() => history.compare(false)}
					/>
				) : null}
				{orphans.length > 0 && content && !viewingOld ? (
					<div className="ablock orphan">
						<div className="lbl">On text that has since changed</div>
						{orphans.map((thread) => (
							<ThreadCard
								key={thread.root.id}
								thread={thread}
								doc={doc}
								focus={thread === focused ? focus : undefined}
							/>
						))}
					</div>
				) : null}
				{resolved.length > 0 && content && !viewingOld ? (
					<ResolvedThreads threads={resolved} doc={doc} />
				) : null}
				{open.length === 0 && draft === null && !viewingOld && content ? (
					<div className="doc-hint">Select any text to comment on it for the agent.</div>
				) : null}
			</div>
		</>
	)
}

/** Headings as a jump list; only worth showing once there are a few. A wide panel shows them as a rail instead. */
function Outline({ headings, scope }: { headings: Heading[]; scope: string }) {
	const anchor = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	if (headings.length < 3) return null
	const top = Math.min(...headings.map((heading) => heading.depth))
	return (
		<>
			<button type="button" ref={anchor} className="btn ghost outline-btn" onClick={() => setOpen(true)}>
				<ListTree className="i sm" strokeWidth={1.6} /> Outline
			</button>
			<Menu anchor={anchor} open={open} onClose={() => setOpen(false)} placement="below-start" width={300}>
				{headings.map((heading) => (
					<MenuItem
						key={heading.index}
						label={
							<span className="ell" style={{ paddingLeft: (heading.depth - top) * 12 }}>
								{heading.text}
							</span>
						}
						onSelect={() => {
							setOpen(false)
							jumpTo(scope, heading.index)
						}}
					/>
				))}
			</Menu>
		</>
	)
}

/**
 * The outline beside a document read at full width, where there is room to keep it in view. It
 * marks the section you are reading, following the document's scroll without re-rendering it.
 */
function OutlineRail({ headings, scope }: { headings: Heading[]; scope: string }) {
	const nav = useRef<HTMLElement>(null)
	const [current, setCurrent] = useState<number | null>(null)
	useMountEffect(() => {
		const doc = nav.current?.closest('.doc')
		if (!doc) return
		let frame = 0
		const update = () => {
			frame = 0
			// Hidden unless the panel is wide.
			if (!nav.current?.offsetParent) return
			const line = doc.getBoundingClientRect().top + 96
			const passed = [...nav.current.querySelectorAll<HTMLElement>('[data-index]')].filter(
				(button) =>
					(document.getElementById(`${scope}-${button.dataset.index}`)?.getBoundingClientRect().top ?? 0) <=
					line,
			)
			setCurrent(passed.length > 0 ? Number(passed.at(-1)?.dataset.index) : null)
		}
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(update)
		}
		doc.addEventListener('scroll', onScroll, { passive: true })
		return () => {
			doc.removeEventListener('scroll', onScroll)
			cancelAnimationFrame(frame)
		}
	})
	const top = Math.min(...headings.map((heading) => heading.depth))
	return (
		<nav ref={nav} className="doc-toc" aria-label="Document outline" hidden={headings.length < 3}>
			{headings.map((heading) => (
				<button
					key={heading.index}
					type="button"
					data-index={heading.index}
					className={[heading.depth === top ? 'top' : '', heading.index === current ? 'on' : '']
						.filter(Boolean)
						.join(' ')}
					aria-current={heading.index === current ? 'location' : undefined}
					style={{ paddingLeft: 8 + (heading.depth - top) * 10 }}
					onClick={() => jumpTo(scope, heading.index)}
				>
					{heading.text}
				</button>
			))}
		</nav>
	)
}

/** The line under a document's title: what it is and how recent, or which version or changes are showing. */
function DocMeta({
	artifact,
	history,
	changes,
}: {
	artifact: TaskArtifact
	history: DocHistory
	changes: DocChanges | null
}) {
	const { versions, old, base } = history
	if (history.readingId !== null && old)
		return (
			<div className="doc-meta">
				{old.label} · {formatAgo(old.createdAt)} ·{' '}
				<button type="button" className="linkbtn" onClick={() => history.read(null)}>
					Back to latest
				</button>
			</div>
		)
	if (history.comparing && base)
		return (
			<div className="doc-meta">
				{changesSummary(base.versionNumber, changes, history.baseFailed)} ·{' '}
				<button type="button" className="linkbtn" onClick={() => history.compare(false)}>
					Hide changes
				</button>
			</div>
		)
	return (
		<div className="doc-meta">
			{[
				docKind(artifact.file_name),
				`updated ${formatAgo(toMs(artifact.last_updated_at))}`,
				versions && versions.archived.length > 0 ? `v${versions.archived.length + 1}` : null,
			]
				.filter(Boolean)
				.join(' · ')}
			{base ? (
				<>
					{' · '}
					<button type="button" className="linkbtn" onClick={() => history.compare(true)}>
						Show changes
					</button>
				</>
			) : null}
		</div>
	)
}

/** Blocks the latest revision dropped, shown struck through where they were. */
function RemovedBlocks({ blocks }: { blocks: string[] | undefined }) {
	return (blocks ?? []).map((text, n) => (
		<div key={`${n}:${text}`} className="ablock removed" aria-label="Removed in the latest revision">
			<Prose text={text} />
		</div>
	))
}

/**
 * Pinned to the bottom of a document showing changes: steps from one changed stretch to the next.
 * The stretches are read from the document when you step, so they follow whatever it shows now.
 */
function ChangeSteps({ count, onDone }: { count: number; onDone: () => void }) {
	const bar = useRef<HTMLDivElement>(null)
	const [position, setPosition] = useState<{ at: number; of: number } | null>(null)
	if (count === 0) return null
	const step = (by: 1 | -1) => {
		const doc = bar.current?.closest('.doc')
		if (!doc) return
		// A run of changed blocks reads as one stretch; step to where each run starts.
		const starts = [...doc.querySelectorAll('.ablock.added, .ablock.changed, .ablock.removed')].filter(
			(block) => !block.previousElementSibling?.matches('.added, .changed, .removed'),
		)
		if (starts.length === 0) return
		const next = ((position?.at ?? (by === 1 ? -1 : 0)) + by + starts.length) % starts.length
		setPosition({ at: next, of: starts.length })
		starts[next]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
	}
	return (
		<div ref={bar} className="change-steps" role="toolbar" aria-label="Changes">
			<button
				type="button"
				className="iconbtn"
				title="Previous change"
				aria-label="Previous change"
				onClick={() => step(-1)}
			>
				<ChevronUp className="i sm" strokeWidth={1.6} />
			</button>
			<button
				type="button"
				className="iconbtn"
				title="Next change"
				aria-label="Next change"
				onClick={() => step(1)}
			>
				<ChevronDown className="i sm" strokeWidth={1.6} />
			</button>
			{position ? (
				<span className="muted">
					{position.at + 1} of {position.of}
				</span>
			) : null}
			<span className="sep" />
			<button type="button" className="linkbtn" onClick={onDone}>
				Hide changes
			</button>
		</div>
	)
}

/** "Changes since v3 · 2 added, 1 reworded", or why there is nothing to show yet. */
function changesSummary(versionNumber: number, changes: DocChanges | null, failed: boolean): string {
	const since = `Changes since v${versionNumber}`
	if (failed) return `${since} could not load`
	if (!changes) return `${since}…`
	const { added, changed, removed } = changes.counts
	const parts = [
		added ? `${added} added` : '',
		changed ? `${changed} reworded` : '',
		removed ? `${removed} removed` : '',
	].filter(Boolean)
	return `${since} · ${parts.length > 0 ? parts.join(', ') : 'only spacing changed'}`
}

/** Two ref callbacks on one element; each keeps its cleanup. */
function mergeRefs(...refs: Array<(element: HTMLDivElement | null) => (() => void) | undefined | void>) {
	return (element: HTMLDivElement | null) => {
		const cleanups = refs.map((ref) => ref(element))
		return () => {
			for (const cleanup of cleanups) cleanup?.()
		}
	}
}

function jumpTo(scope: string, index: number) {
	document.getElementById(`${scope}-${index}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

function Versions({
	versions,
	selected,
	onSelect,
}: {
	versions: { latest: { createdAt: number }; archived: Array<{ id: string; label: string; createdAt: number }> }
	selected: string | null
	onSelect: (id: string | null) => void
}) {
	const anchor = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	const pick = (id: string | null) => {
		setOpen(false)
		onSelect(id)
	}
	return (
		<>
			<button
				type="button"
				ref={anchor}
				className="iconbtn"
				title="Versions"
				aria-label="Versions"
				onClick={() => setOpen(true)}
			>
				<History className="i sm" strokeWidth={1.6} />
			</button>
			<Menu anchor={anchor} open={open} onClose={() => setOpen(false)} placement="below-end" width={240}>
				<MenuItem
					label="Latest"
					detail={formatAgo(versions.latest.createdAt)}
					checked={selected === null}
					onSelect={() => pick(null)}
				/>
				{[...versions.archived]
					.sort((a, b) => b.createdAt - a.createdAt)
					.map((version) => (
						<MenuItem
							key={version.id}
							label={version.label}
							detail={formatAgo(version.createdAt)}
							checked={selected === version.id}
							onSelect={() => pick(version.id)}
						/>
					))}
			</Menu>
		</>
	)
}
