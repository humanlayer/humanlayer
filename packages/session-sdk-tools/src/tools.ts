// The HumanLayer tools riptide-daemon gives its agents, as specs any agent integration can
// register. Names, descriptions and output text copy riptide-daemon's
// src/agents/shared/humanlayer-tools/{schemas,executors}.ts, so skills and habits carry over.
// Parameters use a small neutral shape: toJsonSchema() turns them into JSON Schema, and an
// integration whose agent wants another schema library converts them itself.

import {
	type Channel,
	type DaemonPath,
	type DaemonRequest,
	type DaemonResponse,
	RpcError,
	sleepUnref,
} from '@humanlayer/session-sdk-base'

export type ArtifactComment = DaemonResponse<'comments/get'>['comments'][number]
export type DiffThread = DaemonResponse<'diffComments/get'>['comments'][number]
export type DiffComment = DiffThread['root']
export type CommentUpdateResult = DaemonResponse<'comments/update'> | DaemonResponse<'diffComments/update'>

// ---- output text, as riptide-daemon's executors.ts writes it ----

function formatThread(comment: ArtifactComment, replies: Map<string, ArtifactComment[]>): string {
	const lines = [`<comment id="${comment.truncatedId}">`]
	if (comment.previousBlockText || comment.quotedText || comment.nextBlockText) {
		for (const line of comment.previousBlockText?.split('\n') ?? []) lines.push(`  | ${line}`)
		for (const line of comment.quotedText?.split('\n') ?? []) lines.push(`> | ${line}`)
		for (const line of comment.nextBlockText?.split('\n') ?? []) lines.push(`  | ${line}`)
		lines.push('')
	}
	lines.push(`${comment.userName}${comment.isResolved ? ' [RESOLVED]' : ''}: ${comment.contentText}`)
	for (const reply of replies.get(comment.id) ?? []) {
		lines.push(`  ${reply.userName}${reply.isResolved ? ' [RESOLVED]' : ''}: ${reply.contentText}`)
	}
	lines.push('</comment>')
	return lines.join('\n')
}

export function formatArtifactComments(
	filename: string,
	comments: ArtifactComment[],
	offset: number,
	limit: number,
): string {
	const page = comments.slice(offset, offset + limit)
	if (page.length === 0) return `No comments found on ${filename}`
	const replies = new Map<string, ArtifactComment[]>()
	for (const c of page) {
		if (!c.replyToCommentId) continue
		const list = replies.get(c.replyToCommentId) ?? []
		list.push(c)
		replies.set(c.replyToCommentId, list)
	}
	const threads = page.filter((c) => !c.replyToCommentId).map((c) => formatThread(c, replies))
	const result = `<comments for="${filename}">\n${threads.join('\n\n')}\n</comments>`
	const remaining = Math.max(0, comments.length - offset - page.length)
	return remaining > 0 ? `${result}\n(${remaining} additional comments not returned)` : result
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;')
}

function formatDiffEntry(tag: 'comment' | 'reply', c: DiffComment): string {
	const author = c.createdByAgent ? `${c.createdByUserId}'s agent` : c.createdByUserId
	const text = c.isDeleted ? 'Comment deleted' : c.contentText
	return `  <${tag} id="${c.truncatedId}" author="${escapeXml(author)}">${escapeXml(text)}</${tag}>`
}

export function formatDiffComments(threads: DiffThread[], offset: number, limit: number): string {
	const page = threads.slice(offset, offset + limit)
	if (page.length === 0) return 'No diff comments found for this task'
	const blocks = page.map((t) => {
		const a = t.anchor
		return [
			`<diff_comment id="${t.root.truncatedId}" repo="${escapeXml(a.repoId)}" path="${escapeXml(a.path)}" patch_hash="${escapeXml(a.patchHash)}" start_side="${a.start.side}" start_line="${a.start.line}" end_side="${a.end.side}" end_line="${a.end.line}" resolved="${t.isResolved}">`,
			formatDiffEntry('comment', t.root),
			...t.replies.map((r) => formatDiffEntry('reply', r)),
			'</diff_comment>',
		].join('\n')
	})
	const result = `<diff_comments>\n${blocks.join('\n')}\n</diff_comments>`
	const remaining = Math.max(0, threads.length - offset - page.length)
	return remaining > 0 ? `${result}\n(${remaining} additional threads not returned)` : result
}

function formatUpdate(result: CommentUpdateResult): string {
	const messages: string[] = []
	if (result.updated.length > 0) messages.push(`Updated ${result.updated.length} comment(s)`)
	if (result.failed.length > 0) {
		messages.push(`Failed: ${result.failed.map((f) => `${f.truncatedId}: ${f.reason}`).join(', ')}`)
	}
	return messages.join('. ') || 'No changes made'
}

/** An oRPC error's `data.validArtifacts`, when the artifact was not found. */
function validArtifacts(err: unknown): string[] | undefined {
	if (!(err instanceof RpcError) || typeof err.data !== 'object' || err.data === null) return undefined
	const list = (err.data as { validArtifacts?: unknown }).validArtifacts
	return Array.isArray(list) ? list.map(String) : undefined
}

// ---- parameters ----

interface StringLimits {
	minLength?: number
	maxLength?: number
	pattern?: string
}

/** One tool parameter. `optional` leaves it out of `required`. */
export type Param = { description: string; optional?: boolean } & (
	| ({ type: 'string' } & StringLimits)
	| { type: 'boolean' }
	| { type: 'true' }
	| { type: 'integer'; minimum?: number }
	| { type: 'strings'; minItems?: number; items?: StringLimits & { description?: string } }
)

type ValueOf<P extends Param> = P extends { type: 'string' }
	? string
	: P extends { type: 'boolean' }
		? boolean
		: P extends { type: 'true' }
			? true
			: P extends { type: 'integer' }
				? number
				: string[]

/** The values a tool gets for its parameters. */
export type Values<S extends Record<string, Param>> = {
	[K in keyof S as S[K]['optional'] extends true ? never : K]: ValueOf<S[K]>
} & {
	[K in keyof S as S[K]['optional'] extends true ? K : never]?: ValueOf<S[K]>
}

/** A daemon-plane call for the bound task's channel, with the tool call's abort signal. */
export type Call = <P extends DaemonPath>(path: P, body: DaemonRequest<P>) => Promise<DaemonResponse<P>>

export interface ToolSpec {
	description: string
	params: Record<string, Param>
	/** The agent checks params against the schema before this runs. */
	run: (params: unknown, taskId: string, call: Call) => Promise<string>
}

function tool<const S extends Record<string, Param>>(
	description: string,
	params: S,
	run: (p: Values<S>, taskId: string, call: Call) => Promise<string>,
): ToolSpec {
	return { description, params, run: (p, taskId, call) => run(p as Values<S>, taskId, call) }
}

/** A tool's parameters as a JSON Schema object. */
export type ParamsJsonSchema = {
	type: 'object'
	properties: { [name: string]: object }
	required: string[]
	additionalProperties: false
}

/** The JSON Schema for a tool's parameters. */
export function toJsonSchema(params: Record<string, Param>): ParamsJsonSchema {
	const string = (p: StringLimits & { description?: string }) => ({ type: 'string', ...p })
	const properties = Object.fromEntries(
		Object.entries(params).map(([name, p]) => {
			const { optional: _optional, type, ...rest } = p
			if (type === 'true') return [name, { type: 'boolean', const: true, description: p.description }]
			if (type === 'strings') {
				const { items, ...array } = rest as { items?: StringLimits; minItems?: number; description: string }
				return [name, { type: 'array', items: string(items ?? {}), ...array }]
			}
			return [name, { type, ...rest }]
		}),
	)
	const required = Object.entries(params)
		.filter(([, p]) => !p.optional)
		.map(([name]) => name)
	return { type: 'object', properties, required, additionalProperties: false }
}

// ---- the tools ----

const DIFF_SUFFIX = {
	minLength: 8,
	maxLength: 12,
	pattern: '^[0-9a-fA-F]+$',
	description: 'Unique 8-12 character right-hand UUID suffix from get_diff_comments',
} as const

const paging = (what: string) =>
	({
		limit: { type: 'integer', minimum: 1, optional: true, description: `Max ${what} to return (default: 20)` },
		offset: { type: 'integer', minimum: 0, optional: true, description: `Number of ${what} to skip (default: 0)` },
	}) as const

function requireChange(p: { resolved?: boolean; deleted?: boolean }): void {
	if (p.resolved === undefined && p.deleted === undefined) {
		throw new Error('At least one of resolved or deleted must be provided')
	}
}

export const TOOLS = {
	get_artifact_comments: tool(
		'Get all comments on an artifact (plan.md, research.md, etc). Returns threaded comments in XML format with truncated IDs for referencing in update/reply tools.',
		{
			artifact_filename: {
				type: 'string',
				description: 'Filename of the artifact, e.g. "plan.md", "research.md"',
			},
			include_resolved: {
				type: 'boolean',
				optional: true,
				description: 'Include resolved comments (default: true)',
			},
			...paging('comments'),
		},
		async (p, taskId, call) => {
			const out = await call('comments/get', {
				taskId,
				artifactFilename: p.artifact_filename,
				includeResolved: p.include_resolved ?? true,
			})
			return formatArtifactComments(out.artifactFilename, out.comments, p.offset ?? 0, p.limit ?? 20)
		},
	),
	update_artifact_comments: tool(
		'Update comments on an artifact - mark as resolved or deleted. Use truncated IDs from get_artifact_comments.',
		{
			artifact_filename: { type: 'string', description: 'Filename of the artifact, e.g. "plan.md"' },
			comment_ids: { type: 'strings', minItems: 1, description: 'Truncated comment IDs (last 12 chars)' },
			resolved: { type: 'boolean', optional: true, description: 'Set resolved state for all specified comments' },
			deleted: { type: 'boolean', optional: true, description: 'Set deleted state for all specified comments' },
		},
		async (p, taskId, call) => {
			requireChange(p)
			const body = { taskId, artifactFilename: p.artifact_filename, truncatedCommentIds: p.comment_ids }
			return formatUpdate(await call('comments/update', { ...body, resolved: p.resolved, deleted: p.deleted }))
		},
	),
	reply_to_artifact_comment: tool(
		'Reply to a comment on an artifact. Use truncated ID from get_artifact_comments.',
		{
			artifact_filename: { type: 'string', description: 'Filename of the artifact, e.g. "plan.md"' },
			comment_id: { type: 'string', description: 'Truncated comment ID to reply to' },
			content: { type: 'string', minLength: 1, description: 'Reply text content (markdown supported)' },
		},
		async (p, taskId, call) => {
			const out = await call('comments/reply', {
				taskId,
				artifactFilename: p.artifact_filename,
				truncatedCommentId: p.comment_id,
				contentText: p.content,
			})
			return `Reply added (id: ${out.commentId.slice(-12)})`
		},
	),
	get_diff_comments: tool(
		'Get ordered diff comment threads for the current task, including code anchors and exact short IDs for reply and update tools.',
		{
			include_resolved: {
				type: 'boolean',
				optional: true,
				description: 'Include resolved threads (default: false)',
			},
			...paging('threads'),
		},
		async (p, taskId, call) => {
			const out = await call('diffComments/get', { taskId, includeResolved: p.include_resolved ?? false })
			return formatDiffComments(out.comments, p.offset ?? 0, p.limit ?? 20)
		},
	),
	reply_to_diff_comment: tool(
		'Reply to a diff comment thread in the current task. The reply is added to the root thread and reopens it.',
		{
			thread_id: {
				type: 'string',
				...DIFF_SUFFIX,
				description: 'Root or reply ID suffix for the thread to reply to',
			},
			content: { type: 'string', minLength: 1, description: 'Reply text content (Markdown supported)' },
		},
		async (p, taskId, call) => {
			const out = await call('diffComments/reply', {
				taskId,
				truncatedCommentId: p.thread_id,
				contentText: p.content.trim(),
			})
			return `Reply added (id: ${out.commentId.slice(-12)})`
		},
	),
	update_diff_comments: tool(
		'Resolve, reopen, or soft-delete diff comments in the current task. Resolve a thread only when the user asks you to resolve it or feedback delivery used Send & Resolve. Never resolve a thread just because you replied or changed code. Deletion is limited to comments authored by the driving user.',
		{
			comment_ids: {
				type: 'strings',
				minItems: 1,
				items: DIFF_SUFFIX,
				description: 'Comment or thread ID suffixes to update',
			},
			resolved: {
				type: 'boolean',
				optional: true,
				description: 'Resolve (true) or reopen (false) each matched thread',
			},
			deleted: {
				type: 'true',
				optional: true,
				description: 'Soft-delete matched comments authored by the driving user',
			},
		},
		async (p, taskId, call) => {
			requireChange(p)
			const body = { taskId, truncatedCommentIds: p.comment_ids }
			return formatUpdate(
				await call('diffComments/update', { ...body, resolved: p.resolved, deleted: p.deleted }),
			)
		},
	),
	library_researcher: tool(
		'Research documentation for a library or package to answer questions about usage, APIs, and best practices. Use this when you need up-to-date information about a library or dependency.',
		{
			question: {
				type: 'string',
				description:
					'The specific question you want answered about the library. Be detailed and specific. ' +
					"Good: 'How do I configure authentication middleware in Express.js 5?' " +
					"Bad: 'express auth'",
			},
			package_name: {
				type: 'string',
				description:
					'The exact name of the npm package, PyPI package, or library to research. ' +
					'Use the canonical package name as it appears in the package registry if possible. ' +
					"Examples: 'react', 'express', 'drizzle-orm', '@tanstack/react-query'",
			},
			language: {
				type: 'string',
				description:
					'The programming language(s) in question. E.g. typescript, python, elixir, java, javascript, C, c++, etc',
			},
		},
		async (p, _taskId, call) => {
			const out = await call('agents/research', {
				question: p.question,
				packageName: p.package_name,
				language: p.language,
			})
			return out.response
		},
	),
}

export type ToolName = keyof typeof TOOLS

/** The tool names, in registration order. */
export const HUMANLAYER_TOOLS = Object.keys(TOOLS) as readonly ToolName[]

/** The error a failed call gives the model. Throwing marks the tool result as an error. */
export function toolFailure(name: string, err: unknown): Error {
	const artifacts = validArtifacts(err)
	if (artifacts) return new Error(`Artifact not found. Valid artifacts: ${artifacts.join(', ')}`)
	if (err instanceof RpcError) return new Error(`${name} failed: ${err.message}`)
	return err instanceof Error ? err : new Error(String(err))
}

/** The task a tool acts on, or why there is none. `pending` while the session is still binding. */
export type ToolTarget = { channel: Channel; taskId: string } | { reason: string; pending?: boolean }

/** How long a tool waits for a pending bind: a new session's first prompt may call one at once. */
const BIND_WAIT_MS = 15_000

/** The target once any pending bind has settled, or BIND_WAIT_MS has passed. */
export async function settledTarget(target: () => ToolTarget, signal: AbortSignal | undefined): Promise<ToolTarget> {
	const deadline = Date.now() + BIND_WAIT_MS
	let t = target()
	while ('pending' in t && t.pending && Date.now() < deadline && !signal?.aborted) {
		await sleepUnref(100)
		t = target()
	}
	return t
}

/**
 * Runs one tool for a target, the way every integration does: waits for a pending bind, then
 * calls the daemon plane through `daemonCall`. Throws the message the model should see.
 */
export async function runTool(
	name: ToolName,
	params: unknown,
	target: () => ToolTarget,
	daemonCall: <P extends DaemonPath>(
		channel: Channel,
		path: P,
		body: DaemonRequest<P>,
		signal?: AbortSignal,
	) => Promise<DaemonResponse<P>>,
	signal?: AbortSignal,
): Promise<string> {
	const t = await settledTarget(target, signal)
	if ('reason' in t) throw new Error(t.reason)
	const call: Call = (path, body) => daemonCall(t.channel, path, body, signal)
	try {
		return await TOOLS[name].run(params, t.taskId, call)
	} catch (err) {
		throw toolFailure(name, err)
	}
}
