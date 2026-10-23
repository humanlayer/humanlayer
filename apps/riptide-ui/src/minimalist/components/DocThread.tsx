import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import type { Task } from '@humanlayer/db/tables/tasks'
import { useDraftField } from '@humanlayer/ui/hooks/use-draft-field'
import { draftSessionStorageKeys } from '@humanlayer/ui/lib/draft-session-storage-keys'
import { Check, ChevronDown, ChevronRight, MoreHorizontal, RotateCcw } from 'lucide-react'
import { useRef, useState } from 'react'

import { Byline } from '@/minimalist/components/Avatar'
import { Menu, MenuItem } from '@/minimalist/components/Menu'
import { commentsMessage, type Thread } from '@/minimalist/lib/artifact-comments'
import { hasDraft } from '@/minimalist/lib/comment-drafts'
import { formatAge, plural, toMs } from '@/minimalist/lib/format'
import { useAskAgent } from '@/minimalist/lib/send'
import { type PanelFocus, scrollOnce } from '@/minimalist/lib/thread-panel'
import { useUi } from '@/minimalist/lib/ui-state'
import { useCommentAuthor, useCommentPerson, useDocComments } from '@/minimalist/lib/use-doc-comments'

/** Saving fails at once only before the account has loaded; the box stays open with the text. */
export const UNSAVED_COMMENT = 'Could not save the comment. Your account is still loading; try again in a moment.'

/** What the thread card needs to know about the document it sits in. */
export type DocContext = {
	task: Pick<Task, 'id' | 'resource_owner_user_id'>
	artifactId: string
	fileName: string
	/** Where "Send to the agent" posts the thread. */
	sessionId: string | null
}

/** How a reply or edit box came to be open: you opened it, or it came back with its draft. */
type BoxOpen = 'opened' | 'restored' | null

/** An open thread: its comments, then Reply and Resolve. Your own comments can be edited or deleted. */
export function ThreadCard({ thread, doc, focus }: { thread: Thread; doc: DocContext; focus?: PanelFocus }) {
	const comments = useDocComments(doc.task, doc.artifactId)
	const authorOf = useCommentAuthor()
	const agent = useAskAgent(doc.sessionId)
	const { showToast } = useUi()
	const replyDraft = draftSessionStorageKeys.reply(thread.root.id)
	// A reply you started before a reload or route change opens again with its text.
	const [replying, setReplying] = useState<BoxOpen>(() => (hasDraft(replyDraft) ? 'restored' : null))
	const send = async () => {
		const sent = await agent.ask(commentsMessage(doc.fileName, [thread], authorOf), {
			sent: 'Sent the comment to the agent',
			queued: 'Comment queued. It sends when the agent finishes.',
			failed: 'Could not send the comment. It is still here.',
		})
		if (sent) comments.resolveSent([thread.root.id])
	}
	return (
		<div className={focus ? 'athread on' : 'athread'} ref={scrollOnce(focus, 'center')}>
			{thread.quote ? <blockquote className="aquote">{thread.quote}</blockquote> : null}
			{[thread.root, ...thread.replies].map((row) => (
				<CommentRow
					key={row.id}
					comment={row}
					doc={doc}
					onSend={row === thread.root && doc.sessionId ? () => void send() : undefined}
				/>
			))}
			{replying ? (
				<CommentBox
					placeholder="Reply"
					action="Reply"
					draftKey={replyDraft}
					focus={replying === 'opened'}
					onClose={() => setReplying(null)}
					onSave={(text) => {
						if (comments.reply(thread.root.id, text)) {
							setReplying(null)
							return true
						}
						showToast(UNSAVED_COMMENT)
						return false
					}}
				/>
			) : (
				<div className="acts">
					<button type="button" className="btn ghost" onClick={() => setReplying('opened')}>
						Reply
					</button>
					<button
						type="button"
						className="btn ghost"
						onClick={() => comments.setResolved(thread.root.id, true)}
					>
						<Check className="i sm" /> Resolve
					</button>
				</div>
			)}
		</div>
	)
}

/** Resolved threads, folded away at the end of the document until you want them back. */
export function ResolvedThreads({ threads, doc }: { threads: Thread[]; doc: DocContext }) {
	const comments = useDocComments(doc.task, doc.artifactId)
	const personOf = useCommentPerson()
	const [open, setOpen] = useState(false)
	const Chevron = open ? ChevronDown : ChevronRight
	return (
		<div className="aresolved">
			<button type="button" className="linkbtn" aria-expanded={open} onClick={() => setOpen(!open)}>
				<Chevron className="i sm" strokeWidth={1.6} />
				{plural(threads.length, 'resolved thread')}
			</button>
			{open
				? threads.map((thread) => (
						<div key={thread.root.id} className="athread done">
							{thread.quote ? <blockquote className="aquote">{thread.quote}</blockquote> : null}
							<div className="acomment">
								<div className="who">
									<Byline {...personOf(thread.root)} />
									<span className="muted">
										{formatAge(toMs(thread.root.created_at))}
										{thread.replies.length > 0
											? ` · ${plural(thread.replies.length, 'reply', 'replies')}`
											: ''}
									</span>
									<span className="sp" />
									<button
										type="button"
										className="btn ghost sm"
										onClick={() => comments.setResolved(thread.root.id, false)}
									>
										<RotateCcw className="i sm" strokeWidth={1.6} /> Reopen
									</button>
								</div>
								<div className="what">{thread.root.content_text}</div>
							</div>
						</div>
					))
				: null}
		</div>
	)
}

/** One comment. Its menu sends the thread to the agent, and edits or deletes your own comment. */
function CommentRow({ comment, doc, onSend }: { comment: ArtifactComment; doc: DocContext; onSend?: () => void }) {
	const comments = useDocComments(doc.task, doc.artifactId)
	const personOf = useCommentPerson()
	const anchor = useRef<HTMLButtonElement>(null)
	const [menuOpen, setMenuOpen] = useState(false)
	const editDraft = draftSessionStorageKeys.edit(comment.id)
	const mine = !comment.created_by_agent && comment.created_by_user_id === comments.userId
	// An edit you started before a reload or route change opens again with its text.
	const [editing, setEditing] = useState<BoxOpen>(() => (mine && hasDraft(editDraft) ? 'restored' : null))
	return (
		<div className="acomment">
			<div className="who">
				<Byline {...personOf(comment)} />
				<span className="muted">{formatAge(toMs(comment.created_at))}</span>
				<span className="sp" />
				{onSend || mine ? (
					<button
						type="button"
						ref={anchor}
						className="iconbtn amore"
						title="More"
						aria-label="More actions for this comment"
						aria-expanded={menuOpen}
						onClick={() => setMenuOpen(true)}
					>
						<MoreHorizontal className="i sm" strokeWidth={1.6} />
					</button>
				) : null}
				<Menu
					anchor={anchor}
					open={menuOpen}
					onClose={() => setMenuOpen(false)}
					placement="below-end"
					width={220}
				>
					{onSend ? (
						<MenuItem
							label="Send to the agent"
							detail="Just this thread, then resolve it"
							onSelect={() => {
								setMenuOpen(false)
								onSend()
							}}
						/>
					) : null}
					{mine ? (
						<MenuItem
							label="Edit"
							onSelect={() => {
								setMenuOpen(false)
								setEditing('opened')
							}}
						/>
					) : null}
					{mine ? (
						<MenuItem
							label="Delete"
							detail={onSend ? 'Deletes the replies too' : undefined}
							onSelect={() => {
								setMenuOpen(false)
								comments.remove(comment)
							}}
						/>
					) : null}
				</Menu>
			</div>
			{editing ? (
				<CommentBox
					placeholder="Comment"
					action="Save"
					draftKey={editDraft}
					focus={editing === 'opened'}
					initial={comment.content_text}
					onClose={() => setEditing(null)}
					onSave={(text) => {
						if (text !== comment.content_text) comments.edit(comment.id, text)
						setEditing(null)
					}}
				/>
			) : (
				<div className="what">{comment.content_text}</div>
			)}
		</div>
	)
}

/**
 * You opened the box to type in it: it takes focus, with the caret at the end of any text (editing
 * adds to a comment), and scrolls up far enough if it opened below the fold. Module level, so it
 * runs once per box rather than on each keystroke.
 */
function openBox(box: HTMLDivElement | null) {
	const field = box?.querySelector('textarea')
	field?.focus({ preventScroll: true })
	field?.setSelectionRange(field.value.length, field.value.length)
	box?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

/**
 * A comment being written. Its text is kept as a draft under `draftKey`, so it survives a reload,
 * a route change or a closed panel: Escape closes the box and keeps the draft, Discard throws it away.
 * Saving clears it unless `onSave` returns false.
 */
export function CommentBox({
	placeholder,
	action,
	quote,
	draftKey,
	initial = '',
	focus = true,
	onSave,
	onClose,
}: {
	placeholder: string
	/** The save button's label. */
	action: string
	/** The selected words the comment is about. */
	quote?: string | null
	/** Where the unsent text is kept; one of `draftSessionStorageKeys`. */
	draftKey: string
	/** The comment being edited, when there is no draft of the edit. */
	initial?: string
	/** Take focus on opening. Off for a box reopened from a draft, so the page doesn't jump to it. */
	focus?: boolean
	onSave: (text: string) => boolean | void
	onClose: () => void
}) {
	const draft = useDraftField(draftKey)
	// Seeded once; after that the box owns its text, so emptying the field doesn't bring the comment back.
	const [text, setLocalText] = useState(() => draft.value || initial)
	const setText = (next: string) => {
		setLocalText(next)
		// An edit that matches the comment is no draft.
		if (next === initial) draft.clear()
		else draft.setValue(next)
	}
	const changed = text.trim() !== '' && text !== initial
	const save = () => {
		if (!text.trim()) return
		if (onSave(text.trim()) !== false) draft.clear()
	}
	return (
		<div className="acompose" ref={focus ? openBox : undefined}>
			{quote ? <blockquote className="aquote">{quote}</blockquote> : null}
			<textarea
				rows={2}
				placeholder={placeholder}
				value={text}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Escape') onClose()
					if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
						event.preventDefault()
						save()
					}
				}}
			/>
			<div className="acts">
				<button
					type="button"
					className="btn ghost"
					title={changed ? 'Close and throw away what you wrote' : undefined}
					onClick={() => {
						draft.clear()
						onClose()
					}}
				>
					{changed ? 'Discard' : 'Cancel'}
				</button>
				<button type="button" className="btn primary" disabled={!text.trim()} onClick={save}>
					{action} <span className="kbd inv">⌘⏎</span>
				</button>
			</div>
		</div>
	)
}
