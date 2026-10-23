/**
 * Shared Zod schemas for HumanLayer tools (comments, library researcher).
 * These schemas are used by both the MCP server (Claude Code) and CodeLayer agent.
 */
import * as z from 'zod'

// ============================================================================
// Comment Tool Schemas
// ============================================================================

export const GetArtifactCommentsInputSchema = z.object({
	artifact_filename: z.string().describe('Filename of the artifact, e.g. "plan.md", "research.md"'),
	include_resolved: z.boolean().optional().default(true).describe('Include resolved comments (default: true)'),
	limit: z.number().int().positive().optional().default(20).describe('Max comments to return (default: 20)'),
	offset: z.number().int().nonnegative().optional().default(0).describe('Number of comments to skip (default: 0)'),
})

export type GetArtifactCommentsInput = z.infer<typeof GetArtifactCommentsInputSchema>

export const UpdateArtifactCommentsInputSchema = z.object({
	artifact_filename: z.string().describe('Filename of the artifact, e.g. "plan.md"'),
	comment_ids: z.array(z.string()).min(1).describe('Truncated comment IDs (last 12 chars)'),
	resolved: z.boolean().optional().describe('Set resolved state for all specified comments'),
	deleted: z.boolean().optional().describe('Set deleted state for all specified comments'),
})

export type UpdateArtifactCommentsInput = z.infer<typeof UpdateArtifactCommentsInputSchema>

export const ReplyToArtifactCommentInputSchema = z.object({
	artifact_filename: z.string().describe('Filename of the artifact, e.g. "plan.md"'),
	comment_id: z.string().describe('Truncated comment ID to reply to'),
	content: z.string().min(1).describe('Reply text content (markdown supported)'),
})

export type ReplyToArtifactCommentInput = z.infer<typeof ReplyToArtifactCommentInputSchema>

const DiffCommentSuffixSchema = z
	.string()
	.min(8)
	.max(12)
	.regex(/^[0-9a-fA-F]+$/, 'Comment ID suffix must contain only hexadecimal characters')
	.describe('Unique 8-12 character right-hand UUID suffix from get_diff_comments')

export const GetDiffCommentsInputSchema = z.object({
	include_resolved: z.boolean().optional().default(false).describe('Include resolved threads (default: false)'),
	limit: z.number().int().positive().optional().default(20).describe('Max threads to return (default: 20)'),
	offset: z.number().int().nonnegative().optional().default(0).describe('Number of threads to skip (default: 0)'),
})

export type GetDiffCommentsInput = z.infer<typeof GetDiffCommentsInputSchema>

export const ReplyToDiffCommentInputSchema = z.object({
	thread_id: DiffCommentSuffixSchema.describe('Root or reply ID suffix for the thread to reply to'),
	content: z.string().trim().min(1).describe('Reply text content (Markdown supported)'),
})

export type ReplyToDiffCommentInput = z.infer<typeof ReplyToDiffCommentInputSchema>

export const UpdateDiffCommentsInputSchema = z.object({
	comment_ids: z.array(DiffCommentSuffixSchema).min(1).describe('Comment or thread ID suffixes to update'),
	resolved: z.boolean().optional().describe('Resolve (true) or reopen (false) each matched thread'),
	deleted: z.literal(true).optional().describe('Soft-delete matched comments authored by the driving user'),
})

export type UpdateDiffCommentsInput = z.infer<typeof UpdateDiffCommentsInputSchema>

export const CodeLayerUpdateDiffCommentsInputSchema = z
	.object({
		comment_ids: UpdateDiffCommentsInputSchema.shape.comment_ids,
		resolved: z
			.boolean()
			.nullable()
			.describe('Resolve or reopen matched threads; null leaves resolution unchanged'),
		deleted: z.literal(true).nullable().describe('Delete matched comments; null leaves deletion unchanged'),
	})
	.strict()
	.refine((input) => input.resolved !== null || input.deleted !== null, {
		error: 'At least one of resolved or deleted must be provided',
	})

export type CodeLayerUpdateDiffCommentsInput = z.infer<typeof CodeLayerUpdateDiffCommentsInputSchema>

export function normalizeCodeLayerUpdateDiffCommentsInput(
	input: CodeLayerUpdateDiffCommentsInput,
): UpdateDiffCommentsInput {
	const normalized: UpdateDiffCommentsInput = {
		comment_ids: input.comment_ids,
	}
	if (input.resolved !== null) normalized.resolved = input.resolved
	if (input.deleted !== null) normalized.deleted = input.deleted
	return normalized
}

// ============================================================================
// Library Researcher Tool Schemas
// ============================================================================

export const LibraryResearcherInputSchema = z.object({
	question: z
		.string()
		.describe(
			'The specific question you want answered about the library. Be detailed and specific. ' +
				"Good: 'How do I configure authentication middleware in Express.js 5?' " +
				"Bad: 'express auth'",
		),
	package_name: z
		.string()
		.describe(
			'The exact name of the npm package, PyPI package, or library to research. ' +
				'Use the canonical package name as it appears in the package registry if possible. ' +
				"Examples: 'react', 'express', 'drizzle-orm', '@tanstack/react-query'",
		),
	language: z
		.string()
		.describe(
			'The programming language(s) in question. E.g. typescript, python, elixir, java, javascript, C, c++, etc',
		),
})

export type LibraryResearcherInput = z.infer<typeof LibraryResearcherInputSchema>

// ============================================================================
// Tool Descriptions (shared between MCP and CodeLayer)
// ============================================================================

export const TOOL_DESCRIPTIONS = {
	get_artifact_comments:
		'Get all comments on an artifact (plan.md, research.md, etc). Returns threaded comments in XML format with truncated IDs for referencing in update/reply tools.',
	update_artifact_comments:
		'Update comments on an artifact - mark as resolved or deleted. Use truncated IDs from get_artifact_comments.',
	reply_to_artifact_comment: 'Reply to a comment on an artifact. Use truncated ID from get_artifact_comments.',
	get_diff_comments:
		'Get ordered diff comment threads for the current task, including code anchors and exact short IDs for reply and update tools.',
	reply_to_diff_comment:
		'Reply to a diff comment thread in the current task. The reply is added to the root thread and reopens it.',
	update_diff_comments:
		'Resolve, reopen, or soft-delete diff comments in the current task. Resolve a thread only when the user asks you to resolve it or feedback delivery used Send & Resolve. Never resolve a thread just because you replied or changed code. Deletion is limited to comments authored by the driving user.',
	library_researcher:
		'Research documentation for a library or package to answer questions about usage, APIs, and best practices. Use this when you need up-to-date information about a library or dependency.',
} as const
