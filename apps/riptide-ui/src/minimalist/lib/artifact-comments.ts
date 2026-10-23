import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { normalizeAnchorText, parseAnchorV2 } from '@humanlayer/ui/artifact-viewer-v2'
import { partitionCommentRowsByRootFormat } from '@humanlayer/ui/lib/artifact-comment-format'
import { formatAllThreadsForLlm, RESOLVED_COMMENTS_NOTE } from '@humanlayer/ui/lib/comment-utils'

import { plainText } from '@/minimalist/lib/artifacts'
import { anchorSpan, type DocBlock, type DocPoint } from '@/minimalist/lib/doc-anchors'
import { toMs } from '@/minimalist/lib/format'

export type Thread = {
	root: ArtifactComment
	replies: ArtifactComment[]
	/** The top-level block it sits under (where its text ends), or -1 once that text is gone. */
	block: number
	/** The words it is about, when that is less than its whole block. */
	quote: string | null
	/** Where those words are now, to mark them; older comments name only a block. */
	span: { start: DocPoint; end: DocPoint } | null
}

const byAge = (a: ArtifactComment, b: ArtifactComment) => toMs(a.created_at) - toMs(b.created_at)

/**
 * A document's comment threads, oldest first, and the open ones by the block each sits under.
 * Threads anchor two ways. Current ones carry `anchor_json`, placed the way the standard viewer
 * places them. Older ones carry the block's text, and sit under the block whose text matches it,
 * else the first block that contains it.
 */
export function documentThreads(
	rows: readonly ArtifactComment[],
	blocks: readonly DocBlock[],
	texts: readonly string[],
): { open: Thread[]; resolved: Thread[]; byBlock: Map<number, Thread[]> } {
	const live = rows.filter((row) => !row.is_deleted)
	const { v2, legacy } = partitionCommentRowsByRootFormat(live)
	const threads = [...v2, ...legacy]
		.filter((row) => !row.reply_to_comment_id)
		.sort(byAge)
		.map((root) => ({
			root,
			replies: live.filter((row) => row.reply_to_comment_id === root.id).sort(byAge),
			...placement(root, blocks, texts),
		}))
	const open = threads.filter((thread) => !thread.root.is_resolved)
	const byBlock = new Map<number, Thread[]>()
	for (const thread of open) {
		const list = byBlock.get(thread.block)
		if (list) list.push(thread)
		else byBlock.set(thread.block, [thread])
	}
	return { open, resolved: threads.filter((thread) => thread.root.is_resolved), byBlock }
}

function placement(
	root: ArtifactComment,
	blocks: readonly DocBlock[],
	texts: readonly string[],
): Pick<Thread, 'block' | 'quote' | 'span'> {
	const anchor = parseAnchorV2(root.anchor_json)
	if (anchor) {
		const span = anchorSpan(blocks, anchor)
		const block = span?.end.top ?? -1
		const whole = blocks.filter((candidate) => candidate.top === block).map((candidate) => candidate.text)
		const partial = normalizeAnchorText(anchor.selectedText) !== normalizeAnchorText(whole.join('\n'))
		return { block, quote: partial && anchor.selectedText.trim() ? anchor.selectedText : null, span }
	}
	const text = plainText(root.commented_upon_block_text ?? '')
	const exact = text ? texts.indexOf(text) : -1
	const block = !text || exact !== -1 ? exact : texts.findIndex((candidate) => candidate.includes(text))
	return { block, quote: null, span: null }
}

/** The open thread a comment belongs to, as its root or a reply. */
export function threadOf(threads: readonly Thread[], commentId: string): Thread | undefined {
	return threads.find(
		(thread) => thread.root.id === commentId || thread.replies.some((reply) => reply.id === commentId),
	)
}

/** Whether a linked comment is resolved or deleted, so there's no open thread to show. */
export function isClosedComment(rows: readonly ArtifactComment[], commentId: string): boolean {
	const row = rows.find((candidate) => candidate.id === commentId)
	if (!row) return true
	const root = rows.find((candidate) => candidate.id === row.reply_to_comment_id) ?? row
	return row.is_deleted || row.is_resolved || root.is_deleted || root.is_resolved
}

/** Who wrote a comment: a member, a guest on a share link, or the agent. Keys `commentsMessage`'s names. */
export function authorKey(row: ArtifactComment): string {
	return row.created_by_user_id ?? row.anonymous_author_id ?? row.id
}

/** What "Send to the agent" posts for a document's open threads. `parseCommentMessage` reads it back. */
export function commentsMessage(
	fileName: string,
	threads: readonly Thread[],
	nameOf: (row: ArtifactComment) => string,
): string {
	const rows = threads.flatMap((thread) => [thread.root, ...thread.replies])
	const formatted = formatAllThreadsForLlm({
		artifactFilename: fileName,
		threads: threads.map((thread) => {
			const anchor = parseAnchorV2(thread.root.anchor_json)
			return {
				markdownContext: anchor
					? {
							previousMarkdown: anchor.start.previousBlockText,
							currentMarkdown: anchor.selectedText,
							nextMarkdown: anchor.end.nextBlockText,
						}
					: {
							previousMarkdown: thread.root.previous_block_text,
							currentMarkdown: thread.root.commented_upon_block_text,
							nextMarkdown: thread.root.next_block_text,
						},
				rootComment: {
					id: thread.root.id,
					contentText: thread.root.content_text,
					isResolved: false,
					createdByUserId: authorKey(thread.root),
				},
				replies: thread.replies.map((reply) => ({
					id: reply.id,
					contentText: reply.content_text,
					isResolved: reply.is_resolved,
					createdByUserId: authorKey(reply),
				})),
			}
		}),
		userLookup: new Map(rows.map((row) => [authorKey(row), { displayName: nameOf(row) }] as const)),
	})
	// The threads resolve once sent, so the agent shouldn't go looking for them.
	return formatted.replace('</comments>', `\n\n${RESOLVED_COMMENTS_NOTE}\n</comments>`)
}

type SentComment = { quote: string; lines: string[] }

/**
 * Reads back a message built by `formatAllThreadsForLlm`, so the thread can show
 * "2 comments on plan.md" instead of the XML the agent receives.
 */
export function parseCommentMessage(text: string): { file: string | null; comments: SentComment[] } | null {
	const envelope = text.trim().match(/^<comments(?: for="([^"]*)")?>\n([\s\S]*)\n<\/comments>$/)
	const body = envelope?.[2]
	if (!envelope || body === undefined) return null
	const comments = [...body.matchAll(/<comment(?: id="[^"]*")?>\n([\s\S]*?)\n<\/comment>/g)].map((match) => {
		const rows = (match[1] ?? '').split('\n')
		const quote = rows
			.filter((row) => row.startsWith('> | '))
			.map((row) => row.slice(4))
			.join(' ')
		const lines = rows.filter((row) => row.trim() && !/^(> | {2})\| /.test(row)).map((row) => row.trim())
		return { quote, lines }
	})
	return comments.length ? { file: envelope[1] ?? null, comments } : null
}
