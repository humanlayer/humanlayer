export function getInitials(name?: string): string {
	if (!name) return '?'
	const parts = name.split(/\s+/)
	return parts.length > 1
		? `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase()
		: name.slice(0, 2).toUpperCase()
}

/**
 * Palette of distinct comment highlight colors.
 * Chosen for visibility at 20% opacity (used by color-mix in CSS)
 * and legibility in both light and dark modes.
 */
const COMMENT_COLORS = [
	'#f472b6', // pink
	'#38bdf8', // sky blue
	'#a78bfa', // violet
	'#34d399', // emerald
	'#fbbf24', // amber
	'#fb923c', // orange
	'#f87171', // red
	'#2dd4bf', // teal
]

/**
 * Simple string hash → non-negative integer.
 * Deterministic: same input always produces the same output.
 */
function hashString(s: string): number {
	let h = 0
	for (let i = 0; i < s.length; i++) {
		h = (h * 31 + s.charCodeAt(i)) | 0
	}
	return Math.abs(h)
}

/**
 * Return a stable color for a given user ID.
 * Same user always gets the same color. Cycles through the palette.
 */
export function getCommentColorForUser(userId: string): string {
	return COMMENT_COLORS[hashString(userId) % COMMENT_COLORS.length] ?? '#f472b6'
}

export const RESOLVED_COMMENTS_NOTE =
	'<note>these comments have already been marked as resolved. Once you are done addressing the feedback, you do not need to resolve or reply to them.</note>'

export function formatRelativeTime(timestamp: bigint): string {
	const diff = Date.now() - Number(timestamp)
	const minutes = Math.floor(diff / 60_000)
	if (minutes < 1) return 'just now'
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	return `${days}d ago`
}

/** Markdown block context resolved lazily from the TipTap editor */
export interface MarkdownBlockContext {
	previousMarkdown: string | null
	currentMarkdown: string | null
	nextMarkdown: string | null
}

/** Callback type for lazily resolving markdown context from the editor */
export type GetMarkdownContextForComment = (commentId: string) => MarkdownBlockContext | null

/**
 * Extract truncated comment ID (last 12 chars) from full UUID.
 * Matches daemon pattern in riptide-api/src/orpc/daemon/comments/get.ts
 */
export function getTruncatedCommentId(id: string): string {
	return id.split('-').pop() ?? id
}

/**
 * Format block context lines with > prefix for the commented block.
 */
function formatBlockContextLines(ctx: MarkdownBlockContext): string[] {
	const lines: string[] = []
	if (ctx.previousMarkdown) {
		for (const line of ctx.previousMarkdown.split('\n')) {
			lines.push(`  | ${line}`)
		}
	}
	if (ctx.currentMarkdown) {
		for (const line of ctx.currentMarkdown.split('\n')) {
			lines.push(`> | ${line}`)
		}
	}
	if (ctx.nextMarkdown) {
		for (const line of ctx.nextMarkdown.split('\n')) {
			lines.push(`  | ${line}`)
		}
	}
	return lines
}

interface FormatCommentForLlmOptions {
	/** Artifact filename for the wrapper tag */
	artifactFilename?: string
	/** Comment ID for the comment tag attribute */
	commentId?: string
	/** Markdown block context (prev/current/next) */
	markdownContext?: MarkdownBlockContext | null
	/** Author display name */
	authorName: string
	/** Comment text content */
	commentText: string
	/** Whether the comment is resolved */
	isResolved?: boolean
}

/**
 * Format a single comment for LLM consumption with markdown block context.
 */
export function formatCommentForLlm({
	artifactFilename,
	commentId,
	markdownContext,
	authorName,
	commentText,
	isResolved,
}: FormatCommentForLlmOptions): string {
	const output: string[] = []
	const resolvedTag = isResolved ? ' [RESOLVED]' : ''

	if (markdownContext) {
		output.push(...formatBlockContextLines(markdownContext))
		output.push('')
	}

	output.push(`${authorName}${resolvedTag}: ${commentText}`)

	const idAttr = commentId ? ` id="${getTruncatedCommentId(commentId)}"` : ''
	const commentBlock = `<comment${idAttr}>\n${output.join('\n')}\n</comment>`

	if (artifactFilename) {
		return `<comments for="${artifactFilename}">\n${commentBlock}\n</comments>`
	}
	return commentBlock
}

interface ThreadComment {
	id?: string
	contentText: string
	isResolved?: boolean
	createdByUserId: string
}

interface FormatThreadForLlmOptions {
	/** Artifact filename for the wrapper tag */
	artifactFilename?: string
	/** Markdown block context for the root comment */
	markdownContext?: MarkdownBlockContext | null
	rootComment: ThreadComment
	replies: ThreadComment[]
	userLookup?: Map<string, { displayName?: string }>
}

/**
 * Format an entire comment thread for LLM consumption.
 */
export function formatThreadForLlm({
	artifactFilename,
	markdownContext,
	rootComment,
	replies,
	userLookup,
}: FormatThreadForLlmOptions): string {
	const lines: string[] = []

	const getDisplayName = (userId: string) => userLookup?.get(userId)?.displayName ?? userId

	if (markdownContext) {
		lines.push(...formatBlockContextLines(markdownContext))
		lines.push('')
	}

	const rootResolvedTag = rootComment.isResolved ? ' [RESOLVED]' : ''
	lines.push(`${getDisplayName(rootComment.createdByUserId)}${rootResolvedTag}: ${rootComment.contentText}`)

	for (const reply of replies) {
		const replyResolvedTag = reply.isResolved ? ' [RESOLVED]' : ''
		lines.push(`  ${getDisplayName(reply.createdByUserId)}${replyResolvedTag}: ${reply.contentText}`)
	}

	const idAttr = rootComment.id ? ` id="${getTruncatedCommentId(rootComment.id)}"` : ''
	const commentBlock = `<comment${idAttr}>\n${lines.join('\n')}\n</comment>`

	if (artifactFilename) {
		return `<comments for="${artifactFilename}">\n${commentBlock}\n</comments>`
	}
	return commentBlock
}

interface FormatAllThreadsForLlmOptions {
	/** Artifact filename for the wrapper tag */
	artifactFilename?: string
	threads: Array<{
		markdownContext?: MarkdownBlockContext | null
		rootComment: ThreadComment
		replies: ThreadComment[]
	}>
	userLookup?: Map<string, { displayName?: string }>
}

/**
 * Format multiple comment threads for LLM consumption.
 * Wraps all threads in a <comments for="filename"> tag.
 */
export function formatAllThreadsForLlm({
	artifactFilename,
	threads,
	userLookup,
}: FormatAllThreadsForLlmOptions): string {
	if (threads.length === 0) {
		return ''
	}

	const commentBlocks = threads
		.map((thread) => {
			const lines: string[] = []
			const getDisplayName = (userId: string) => userLookup?.get(userId)?.displayName ?? userId

			if (thread.markdownContext) {
				lines.push(...formatBlockContextLines(thread.markdownContext))
				lines.push('')
			}

			const rootResolvedTag = thread.rootComment.isResolved ? ' [RESOLVED]' : ''
			lines.push(
				`${getDisplayName(thread.rootComment.createdByUserId)}${rootResolvedTag}: ${thread.rootComment.contentText}`,
			)

			for (const reply of thread.replies) {
				const replyResolvedTag = reply.isResolved ? ' [RESOLVED]' : ''
				lines.push(`  ${getDisplayName(reply.createdByUserId)}${replyResolvedTag}: ${reply.contentText}`)
			}

			const idAttr = thread.rootComment.id ? ` id="${getTruncatedCommentId(thread.rootComment.id)}"` : ''
			return `<comment${idAttr}>\n${lines.join('\n')}\n</comment>`
		})
		.join('\n\n')

	const forAttr = artifactFilename ? ` for="${artifactFilename}"` : ''
	return `<comments${forAttr}>\n${commentBlocks}\n</comments>`
}
