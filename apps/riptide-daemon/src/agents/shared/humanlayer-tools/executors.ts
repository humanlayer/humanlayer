import { Data, Effect } from 'effect'

/**
 * Shared executors and formatting utilities for HumanLayer tools.
 * These are used by both the MCP server and CodeLayer agent tool factories.
 */
import logger from '@/logger'

import type { DaemonTaskCapabilityError } from '../../../effects/services/daemon-api/daemon-api.errors'
import { DaemonApi } from '../../../effects/services/daemon-api/daemon-api.service'
import type { ORPCClient } from '../../claudecode/types'
import type {
	GetDiffCommentsInput,
	GetArtifactCommentsInput,
	LibraryResearcherInput,
	ReplyToDiffCommentInput,
	ReplyToArtifactCommentInput,
	UpdateDiffCommentsInput,
	UpdateArtifactCommentsInput,
} from './schemas'

// ============================================================================
// Types
// ============================================================================

export interface HumanlayerToolsApi {
	readonly comments: {
		readonly get: ORPCClient['comments']['get']
		readonly update: ORPCClient['comments']['update']
		readonly reply: ORPCClient['comments']['reply']
	}
	readonly agents: {
		readonly research: ORPCClient['agents']['research']
	}
}

export type CommentItem = {
	id: string
	truncatedId: string
	userName: string
	isResolved: boolean
	createdByAgent: boolean
	contentText: string
	quotedText: string | null
	previousBlockText: string | null
	nextBlockText: string | null
	replyToCommentId: string | null
}

export type ExecutorResult<T = string> =
	| { success: true; data: T }
	| { success: false; error: string; validArtifacts?: string[] }

type DiffCommentThread = Awaited<ReturnType<ORPCClient['diffComments']['get']>>['comments'][number]

export type RunDiffCommentToolEffect = <A>(effect: Effect.Effect<A, DaemonTaskCapabilityError, DaemonApi>) => Promise<A>

export class HumanlayerToolInputError extends Data.TaggedError('HumanlayerToolInputError')<{
	readonly message: string
}> {}

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Build comments output in formatThreadForLlm style.
 * Each thread is wrapped in <comment id="..."> tags with block context and threaded replies.
 */
export function buildCommentsOutput(artifactFilename: string, comments: ReadonlyArray<CommentItem>): string {
	// Group comments by parent
	const rootComments = comments.filter((c) => !c.replyToCommentId)
	const repliesByParent = new Map<string, CommentItem[]>()

	for (const comment of comments) {
		if (comment.replyToCommentId) {
			const existing = repliesByParent.get(comment.replyToCommentId) ?? []
			existing.push(comment)
			repliesByParent.set(comment.replyToCommentId, existing)
		}
	}

	const commentBlocks = rootComments.map((comment) => formatCommentThread(comment, repliesByParent)).join('\n\n')
	return `<comments for="${artifactFilename}">\n${commentBlocks}\n</comments>`
}

/**
 * Format a single comment thread with block context and replies.
 */
function formatCommentThread(comment: CommentItem, repliesByParent: Map<string, CommentItem[]>): string {
	const lines: string[] = []

	lines.push(`<comment id="${comment.truncatedId}">`)

	// Add block context if available
	if (comment.previousBlockText || comment.quotedText || comment.nextBlockText) {
		if (comment.previousBlockText) {
			for (const line of comment.previousBlockText.split('\n')) {
				lines.push(`  | ${line}`)
			}
		}
		if (comment.quotedText) {
			for (const line of comment.quotedText.split('\n')) {
				lines.push(`> | ${line}`)
			}
		}
		if (comment.nextBlockText) {
			for (const line of comment.nextBlockText.split('\n')) {
				lines.push(`  | ${line}`)
			}
		}
		lines.push('')
	}

	// Add comment with author and resolved tag
	const resolvedTag = comment.isResolved ? ' [RESOLVED]' : ''
	lines.push(`${comment.userName}${resolvedTag}: ${comment.contentText}`)

	// Find and add replies
	const replies = repliesByParent.get(comment.id) ?? []
	for (const reply of replies) {
		const replyResolvedTag = reply.isResolved ? ' [RESOLVED]' : ''
		lines.push(`  ${reply.userName}${replyResolvedTag}: ${reply.contentText}`)
	}

	lines.push('</comment>')
	return lines.join('\n')
}

/**
 * Format an error that may include valid artifacts list.
 */
export function formatErrorWithArtifacts(error: unknown): string {
	const err = error as { data?: { validArtifacts?: string[] } }
	if (err.data?.validArtifacts) {
		return `Artifact not found. Valid artifacts: ${err.data.validArtifacts.join(', ')}`
	}
	return 'Failed to fetch comments'
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;')
}

function formatDiffCommentAuthor(comment: DiffCommentThread['root']): string {
	return comment.createdByAgent ? `${comment.createdByUserId}'s agent` : comment.createdByUserId
}

function formatDiffCommentEntry(tagName: 'comment' | 'reply', comment: DiffCommentThread['root']): string {
	const text = comment.isDeleted ? 'Comment deleted' : comment.contentText
	return `  <${tagName} id="${comment.truncatedId}" author="${escapeXml(formatDiffCommentAuthor(comment))}">${escapeXml(text)}</${tagName}>`
}

function formatDiffCommentSource(anchor: DiffCommentThread['anchor']): string {
	return anchor.sourceVersionId ? `version ${anchor.sourceVersionId}` : 'task start'
}

function formatDiffCommentThread(thread: DiffCommentThread): string {
	const { anchor } = thread
	const lines = [
		`<diff_comment id="${thread.root.truncatedId}" repo="${escapeXml(anchor.repoId)}" path="${escapeXml(anchor.path)}" patch_hash="${escapeXml(anchor.patchHash)}" source="${escapeXml(formatDiffCommentSource(anchor))}" start_side="${anchor.start.side}" start_line="${anchor.start.line}" end_side="${anchor.end.side}" end_line="${anchor.end.line}" resolved="${thread.isResolved}">`,
	]
	if (anchor.selectedDiff) lines.push(`  <selected_diff>\n${escapeXml(anchor.selectedDiff)}\n  </selected_diff>`)
	lines.push(
		formatDiffCommentEntry('comment', thread.root),
		...thread.replies.map((reply) => formatDiffCommentEntry('reply', reply)),
		'</diff_comment>',
	)
	return lines.join('\n')
}

export function formatDiffCommentsPage(comments: readonly DiffCommentThread[], offset: number, limit: number): string {
	const page = comments.slice(offset, offset + limit)
	if (page.length === 0) return 'No diff comments found for this task'
	const remaining = Math.max(0, comments.length - offset - page.length)
	const result = `<diff_comments>\n${page.map(formatDiffCommentThread).join('\n')}\n</diff_comments>`
	return remaining > 0 ? `${result}\n(${remaining} additional threads not returned)` : result
}

export function formatArtifactCommentsPage(
	artifactFilename: string,
	comments: ReadonlyArray<CommentItem>,
	offset: number,
	limit: number,
): string {
	const page = comments.slice(offset, offset + limit)
	if (page.length === 0) return `No comments found on ${artifactFilename}`
	const remaining = Math.max(0, comments.length - offset - page.length)
	const result = buildCommentsOutput(artifactFilename, page)
	return remaining > 0 ? `${result}\n(${remaining} additional comments not returned)` : result
}

const formatCommentUpdateResult = (result: {
	readonly updated: ReadonlyArray<unknown>
	readonly failed: ReadonlyArray<{ readonly truncatedId: string; readonly reason: string }>
}): string => {
	const messages: Array<string> = []
	if (result.updated.length > 0) messages.push(`Updated ${result.updated.length} comment(s)`)
	if (result.failed.length > 0) {
		messages.push(
			`Failed: ${result.failed.map((failure) => `${failure.truncatedId}: ${failure.reason}`).join(', ')}`,
		)
	}
	return messages.join('. ') || 'No changes made'
}

export const executeGetArtifactCommentsEffect = Effect.fn('humanlayer_tools.get_artifact_comments')(function* (input: {
	readonly taskId: string
	readonly toolInput: GetArtifactCommentsInput
}) {
	const daemonApi = yield* DaemonApi
	const result = yield* daemonApi.getArtifactComments({
		taskId: input.taskId,
		artifactFilename: input.toolInput.artifact_filename,
		includeResolved: input.toolInput.include_resolved,
	})
	return formatArtifactCommentsPage(
		result.artifactFilename,
		result.comments,
		input.toolInput.offset,
		input.toolInput.limit,
	)
})

export const executeUpdateArtifactCommentsEffect = Effect.fn('humanlayer_tools.update_artifact_comments')(
	function* (input: { readonly taskId: string; readonly toolInput: UpdateArtifactCommentsInput }) {
		if (input.toolInput.resolved === undefined && input.toolInput.deleted === undefined) {
			return yield* new HumanlayerToolInputError({
				message: 'At least one of resolved or deleted must be provided',
			})
		}
		const daemonApi = yield* DaemonApi
		const result = yield* daemonApi.updateArtifactComments({
			taskId: input.taskId,
			artifactFilename: input.toolInput.artifact_filename,
			truncatedCommentIds: input.toolInput.comment_ids,
			resolved: input.toolInput.resolved,
			deleted: input.toolInput.deleted,
		})
		return formatCommentUpdateResult(result)
	},
)

export const executeReplyToArtifactCommentEffect = Effect.fn('humanlayer_tools.reply_to_artifact_comment')(
	function* (input: { readonly taskId: string; readonly toolInput: ReplyToArtifactCommentInput }) {
		const daemonApi = yield* DaemonApi
		const result = yield* daemonApi.replyToArtifactComment({
			taskId: input.taskId,
			artifactFilename: input.toolInput.artifact_filename,
			truncatedCommentId: input.toolInput.comment_id,
			contentText: input.toolInput.content,
		})
		return `Reply added (id: ${result.commentId.slice(-12)})`
	},
)

export const executeLibraryResearcherEffect = Effect.fn('humanlayer_tools.library_researcher')(function* (input: {
	readonly toolInput: LibraryResearcherInput
}) {
	const daemonApi = yield* DaemonApi
	const result = yield* daemonApi.researchLibrary({
		question: input.toolInput.question,
		packageName: input.toolInput.package_name,
		language: input.toolInput.language,
	})
	return result.response
})

export function formatDiffCommentToolError(error: unknown): string {
	if (typeof error !== 'object' || error === null) return 'Diff comment request failed'
	if ('data' in error && typeof error.data === 'object' && error.data !== null && 'message' in error.data) {
		return typeof error.data.message === 'string' ? error.data.message : 'Diff comment request failed'
	}
	if ('cause' in error) return formatDiffCommentToolError(error.cause)
	return 'Diff comment request failed'
}

export const executeGetDiffComments = Effect.fn('humanlayer_tools.get_diff_comments')(function* (input: {
	readonly taskId: string
	readonly toolInput: GetDiffCommentsInput
}) {
	const daemonApi = yield* DaemonApi
	const result = yield* daemonApi.getDiffComments({
		taskId: input.taskId,
		includeResolved: input.toolInput.include_resolved,
	})
	return formatDiffCommentsPage(result.comments, input.toolInput.offset, input.toolInput.limit)
})

export const executeReplyToDiffComment = Effect.fn('humanlayer_tools.reply_to_diff_comment')(function* (input: {
	readonly taskId: string
	readonly toolInput: ReplyToDiffCommentInput
}) {
	const daemonApi = yield* DaemonApi
	const result = yield* daemonApi.replyToDiffComment({
		taskId: input.taskId,
		truncatedCommentId: input.toolInput.thread_id,
		contentText: input.toolInput.content,
	})
	return `Reply added (id: ${result.commentId.slice(-12)})`
})

export const executeUpdateDiffComments = Effect.fn('humanlayer_tools.update_diff_comments')(function* (input: {
	readonly taskId: string
	readonly toolInput: UpdateDiffCommentsInput
}) {
	const daemonApi = yield* DaemonApi
	const result = yield* daemonApi.updateDiffComments({
		taskId: input.taskId,
		truncatedCommentIds: input.toolInput.comment_ids,
		resolved: input.toolInput.resolved,
		deleted: input.toolInput.deleted,
	})
	return formatCommentUpdateResult(result)
})

// ============================================================================
// Tool Executors
// ============================================================================

/**
 * Execute get_artifact_comments tool logic.
 */
export async function executeGetArtifactComments(
	orpc: HumanlayerToolsApi,
	taskId: string,
	input: GetArtifactCommentsInput,
): Promise<ExecutorResult<string>> {
	try {
		const result = await orpc.comments.get({
			taskId,
			artifactFilename: input.artifact_filename,
			includeResolved: input.include_resolved ?? true,
		})

		return {
			success: true,
			data: formatArtifactCommentsPage(
				result.artifactFilename,
				result.comments,
				input.offset ?? 0,
				input.limit ?? 20,
			),
		}
	} catch (error) {
		logger.error({ error }, 'get_artifact_comments executor failed')
		const err = error as { data?: { validArtifacts?: string[] } }
		if (err.data?.validArtifacts) {
			return {
				success: false,
				error: 'Artifact not found',
				validArtifacts: err.data.validArtifacts,
			}
		}
		return { success: false, error: 'Failed to fetch comments' }
	}
}

/**
 * Execute update_artifact_comments tool logic.
 */
export async function executeUpdateArtifactComments(
	orpc: HumanlayerToolsApi,
	taskId: string,
	input: UpdateArtifactCommentsInput,
): Promise<ExecutorResult<string>> {
	if (input.resolved === undefined && input.deleted === undefined) {
		return { success: false, error: 'At least one of resolved or deleted must be provided' }
	}

	try {
		const result = await orpc.comments.update({
			taskId,
			artifactFilename: input.artifact_filename,
			truncatedCommentIds: input.comment_ids,
			resolved: input.resolved,
			deleted: input.deleted,
		})

		return { success: true, data: formatCommentUpdateResult(result) }
	} catch (error) {
		logger.error({ error }, 'update_artifact_comments executor failed')
		return { success: false, error: 'Failed to update comments' }
	}
}

/**
 * Execute reply_to_artifact_comment tool logic.
 */
export async function executeReplyToArtifactComment(
	orpc: HumanlayerToolsApi,
	taskId: string,
	input: ReplyToArtifactCommentInput,
): Promise<ExecutorResult<string>> {
	try {
		const result = await orpc.comments.reply({
			taskId,
			artifactFilename: input.artifact_filename,
			truncatedCommentId: input.comment_id,
			contentText: input.content,
		})

		const truncatedNewId = result.commentId.slice(-12)
		return { success: true, data: `Reply added (id: ${truncatedNewId})` }
	} catch (error) {
		logger.error({ error }, 'reply_to_artifact_comment executor failed')
		const message =
			error instanceof Error && 'data' in error
				? ((error as { data?: { message?: string } }).data?.message ?? 'Failed to reply')
				: 'Failed to reply to comment'
		return { success: false, error: message }
	}
}

/**
 * Execute library_researcher tool logic.
 */
export async function executeLibraryResearcher(
	orpc: HumanlayerToolsApi,
	input: LibraryResearcherInput,
): Promise<ExecutorResult<string>> {
	try {
		logger.info({ packageName: input.package_name }, 'library_researcher executor invoked')

		const result = await orpc.agents.research({
			question: input.question,
			packageName: input.package_name,
			language: input.language,
		})

		return { success: true, data: result.response }
	} catch (error) {
		logger.error({ error, packageName: input.package_name }, 'library_researcher executor failed')
		return {
			success: false,
			error: "I'm sorry, I encountered an error while researching that library. Please try again or rephrase your question.",
		}
	}
}
