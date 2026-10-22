/**
 * HumanLayer tools for the CodeLayer agent.
 * Uses the AgentLayer `defineTool` format.
 */
import type { Tool } from '@humanlayer/agentlayer-core'
import { defineTool } from '@humanlayer/agentlayer-core'

import type { ORPCClient } from '../../claudecode/types'
import {
	executeGetArtifactComments,
	executeGetDiffComments,
	executeLibraryResearcher,
	executeReplyToArtifactComment,
	executeReplyToDiffComment,
	executeUpdateArtifactComments,
	executeUpdateDiffComments,
	formatDiffCommentToolError,
	type RunDiffCommentToolEffect,
} from './executors'
import {
	CodeLayerUpdateDiffCommentsInputSchema,
	GetArtifactCommentsInputSchema,
	GetDiffCommentsInputSchema,
	LibraryResearcherInputSchema,
	ReplyToArtifactCommentInputSchema,
	ReplyToDiffCommentInputSchema,
	TOOL_DESCRIPTIONS,
	UpdateArtifactCommentsInputSchema,
	normalizeCodeLayerUpdateDiffCommentsInput,
} from './schemas'

// ============================================================================
// Comment Tools Factory
// ============================================================================

export interface CommentToolsOptions {
	orpc: ORPCClient
	taskId: string
}

/**
 * Create comment tools for the CodeLayer agent.
 * Returns a record of tools that can be spread into the agent's tool map.
 */
export function createCommentTools(options: CommentToolsOptions) {
	const { orpc, taskId } = options

	return {
		get_artifact_comments: defineTool({
			name: 'get_artifact_comments',
			description: TOOL_DESCRIPTIONS.get_artifact_comments,
			input: GetArtifactCommentsInputSchema,
			execute: async (input) => {
				const result = await executeGetArtifactComments(orpc, taskId, input)
				if (result.success) {
					return result.data
				}
				// Return error message as string (CodeLayer tools return strings)
				if (result.validArtifacts) {
					return `Artifact not found. Valid artifacts: ${result.validArtifacts.join(', ')}`
				}
				return `Error: ${result.error}`
			},
		}),

		update_artifact_comments: defineTool({
			name: 'update_artifact_comments',
			description: TOOL_DESCRIPTIONS.update_artifact_comments,
			input: UpdateArtifactCommentsInputSchema,
			execute: async (input) => {
				const result = await executeUpdateArtifactComments(orpc, taskId, input)
				if (result.success) {
					return result.data
				}
				return `Error: ${result.error}`
			},
		}),

		reply_to_artifact_comment: defineTool({
			name: 'reply_to_artifact_comment',
			description: TOOL_DESCRIPTIONS.reply_to_artifact_comment,
			input: ReplyToArtifactCommentInputSchema,
			execute: async (input) => {
				const result = await executeReplyToArtifactComment(orpc, taskId, input)
				if (result.success) {
					return result.data
				}
				return `Error: ${result.error}`
			},
		}),
	}
}

export interface DiffCommentToolsOptions {
	runDiffCommentEffect: RunDiffCommentToolEffect
	taskId: string
}

export function createDiffCommentTools(options: DiffCommentToolsOptions) {
	const { runDiffCommentEffect, taskId } = options
	return {
		get_diff_comments: defineTool({
			name: 'get_diff_comments',
			description: TOOL_DESCRIPTIONS.get_diff_comments,
			input: GetDiffCommentsInputSchema,
			execute: async (input) => {
				try {
					return await runDiffCommentEffect(executeGetDiffComments({ taskId, toolInput: input }))
				} catch (error) {
					return `Error: ${formatDiffCommentToolError(error)}`
				}
			},
		}),
		reply_to_diff_comment: defineTool({
			name: 'reply_to_diff_comment',
			description: TOOL_DESCRIPTIONS.reply_to_diff_comment,
			input: ReplyToDiffCommentInputSchema,
			execute: async (input) => {
				try {
					return await runDiffCommentEffect(executeReplyToDiffComment({ taskId, toolInput: input }))
				} catch (error) {
					return `Error: ${formatDiffCommentToolError(error)}`
				}
			},
		}),
		update_diff_comments: defineTool({
			name: 'update_diff_comments',
			description: TOOL_DESCRIPTIONS.update_diff_comments,
			input: CodeLayerUpdateDiffCommentsInputSchema,
			execute: async (input) => {
				try {
					return await runDiffCommentEffect(
						executeUpdateDiffComments({
							taskId,
							toolInput: normalizeCodeLayerUpdateDiffCommentsInput(input),
						}),
					)
				} catch (error) {
					return `Error: ${formatDiffCommentToolError(error)}`
				}
			},
		}),
	}
}

// ============================================================================
// Library Researcher Tool Factory
// ============================================================================

export interface LibraryResearcherToolOptions {
	orpc: ORPCClient
}

/**
 * Create the library researcher tool for the CodeLayer agent.
 */
export function createLibraryResearcherTool(options: LibraryResearcherToolOptions): Tool {
	const { orpc } = options

	return defineTool({
		name: 'library_researcher',
		description: TOOL_DESCRIPTIONS.library_researcher,
		input: LibraryResearcherInputSchema,
		execute: async (input) => {
			const result = await executeLibraryResearcher(orpc, input)
			if (result.success) {
				return result.data
			}
			return `Error: ${result.error}`
		},
	})
}

// ============================================================================
// Combined Factory
// ============================================================================

export interface HumanlayerToolsOptions {
	orpc: ORPCClient
	runDiffCommentEffect: RunDiffCommentToolEffect
	taskId: string | null
	enableLibraryResearcher: boolean
}

/**
 * Create all HumanLayer tools for the CodeLayer agent.
 * Returns a record of tools that can be spread into the agent's tool map.
 *
 * - Comment tools are only included when taskId is provided
 * - Library researcher is only included when enableLibraryResearcher is true
 */
export function createHumanlayerTools(options: HumanlayerToolsOptions): Record<string, Tool> {
	const { orpc, runDiffCommentEffect, taskId, enableLibraryResearcher } = options
	const tools: Record<string, Tool> = {}

	// Add comment tools if task exists
	if (taskId) {
		const commentTools = createCommentTools({ orpc, taskId })
		const diffCommentTools = createDiffCommentTools({ runDiffCommentEffect, taskId })
		Object.assign(tools, commentTools, diffCommentTools)
	}

	// Add library researcher if enabled
	if (enableLibraryResearcher) {
		tools.library_researcher = createLibraryResearcherTool({ orpc })
	}

	return tools
}
