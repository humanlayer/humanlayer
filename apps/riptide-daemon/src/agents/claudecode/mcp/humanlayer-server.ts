import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { Effect } from 'effect'

import type { DaemonTaskCapabilityError } from '@/effects/services/daemon-api/daemon-api.errors'
import type { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import logger from '@/logger'

import {
	executeGetArtifactComments,
	executeGetDiffComments,
	executeLibraryResearcher,
	executeReplyToArtifactComment,
	executeReplyToDiffComment,
	executeUpdateArtifactComments,
	executeUpdateDiffComments,
	formatDiffCommentToolError,
	GetArtifactCommentsInputSchema,
	GetDiffCommentsInputSchema,
	LibraryResearcherInputSchema,
	ReplyToArtifactCommentInputSchema,
	ReplyToDiffCommentInputSchema,
	TOOL_DESCRIPTIONS,
	UpdateArtifactCommentsInputSchema,
	UpdateDiffCommentsInputSchema,
} from '../../shared/humanlayer-tools'
import type { HumanlayerToolsApi } from '../../shared/humanlayer-tools/executors'

export interface HumanlayerMcpToolsApi extends HumanlayerToolsApi {
	readonly runDiffCommentEffect: <A>(effect: Effect.Effect<A, DaemonTaskCapabilityError, DaemonApi>) => Promise<A>
}

export function createClaudeDiffCommentTools(orpc: HumanlayerMcpToolsApi, taskId: string) {
	return [
		tool(
			'get_diff_comments',
			TOOL_DESCRIPTIONS.get_diff_comments,
			GetDiffCommentsInputSchema.shape,
			async (args) => {
				try {
					const text = await orpc.runDiffCommentEffect(executeGetDiffComments({ taskId, toolInput: args }))
					return { content: [{ type: 'text' as const, text }] }
				} catch (error) {
					return {
						content: [{ type: 'text' as const, text: formatDiffCommentToolError(error) }],
						isError: true,
					}
				}
			},
		),
		tool(
			'reply_to_diff_comment',
			TOOL_DESCRIPTIONS.reply_to_diff_comment,
			ReplyToDiffCommentInputSchema.shape,
			async (args) => {
				try {
					const text = await orpc.runDiffCommentEffect(executeReplyToDiffComment({ taskId, toolInput: args }))
					return { content: [{ type: 'text' as const, text }] }
				} catch (error) {
					return {
						content: [{ type: 'text' as const, text: formatDiffCommentToolError(error) }],
						isError: true,
					}
				}
			},
		),
		tool(
			'update_diff_comments',
			TOOL_DESCRIPTIONS.update_diff_comments,
			UpdateDiffCommentsInputSchema.shape,
			async (args) => {
				try {
					const text = await orpc.runDiffCommentEffect(executeUpdateDiffComments({ taskId, toolInput: args }))
					return { content: [{ type: 'text' as const, text }] }
				} catch (error) {
					return {
						content: [{ type: 'text' as const, text: formatDiffCommentToolError(error) }],
						isError: true,
					}
				}
			},
		),
	] as const
}

/**
 * Create the HumanLayer MCP server with the given oRPC client.
 * Server name: "humanlayer" → tools appear as mcp__humanlayer__*
 *
 * @param orpc - oRPC client for calling backend procedures
 * @param options.taskId - Task ID for comment context. If null, comment tools are excluded (ad-hoc sessions).
 * @param options.enableLibraryResearcher - Whether to include the library researcher tool (requires experimental subagents).
 * @returns The MCP server, or null if no tools are available.
 */
export function createHumanlayerMcpServer(
	orpc: HumanlayerMcpToolsApi,
	options: { taskId: string | null; enableLibraryResearcher: boolean },
): ReturnType<typeof createSdkMcpServer> | null {
	const { taskId, enableLibraryResearcher } = options

	logger.info({ taskId, enableLibraryResearcher }, '[MCP] createHumanlayerMcpServer called')

	const libraryResearcherTool = tool(
		'library_researcher',
		TOOL_DESCRIPTIONS.library_researcher,
		LibraryResearcherInputSchema.shape,
		async (args) => {
			logger.info({ packageName: args.package_name }, 'MCP library_researcher tool invoked')
			const result = await executeLibraryResearcher(orpc, args)
			if (result.success) {
				return { content: [{ type: 'text' as const, text: result.data }] }
			}
			return { content: [{ type: 'text' as const, text: result.error }], isError: true }
		},
	)

	// Comment tools - only available when session has a task
	const artifactCommentTools = taskId
		? [
				tool(
					'get_artifact_comments',
					TOOL_DESCRIPTIONS.get_artifact_comments,
					GetArtifactCommentsInputSchema.shape,
					async (args) => {
						const result = await executeGetArtifactComments(orpc, taskId, args)
						if (result.success) {
							return { content: [{ type: 'text' as const, text: result.data }] }
						}
						const errorMsg = result.validArtifacts
							? `Artifact not found. Valid artifacts: ${result.validArtifacts.join(', ')}`
							: result.error
						return { content: [{ type: 'text' as const, text: errorMsg }], isError: true }
					},
				),
				tool(
					'update_artifact_comments',
					TOOL_DESCRIPTIONS.update_artifact_comments,
					UpdateArtifactCommentsInputSchema.shape,
					async (args) => {
						const result = await executeUpdateArtifactComments(orpc, taskId, args)
						if (result.success) {
							return { content: [{ type: 'text' as const, text: result.data }] }
						}
						return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true }
					},
				),
				tool(
					'reply_to_artifact_comment',
					TOOL_DESCRIPTIONS.reply_to_artifact_comment,
					ReplyToArtifactCommentInputSchema.shape,
					async (args) => {
						const result = await executeReplyToArtifactComment(orpc, taskId, args)
						if (result.success) {
							return { content: [{ type: 'text' as const, text: result.data }] }
						}
						return { content: [{ type: 'text' as const, text: result.error }], isError: true }
					},
				),
			]
		: []
	const commentTools = taskId ? [...artifactCommentTools, ...createClaudeDiffCommentTools(orpc, taskId)] : []

	// Build tools array based on what's enabled
	const tools: Array<(typeof commentTools)[number] | typeof libraryResearcherTool> = [...commentTools]
	if (enableLibraryResearcher) tools.unshift(libraryResearcherTool)

	const toolNames = tools.map((t) => t.name)
	logger.info(
		{
			taskId,
			enableLibraryResearcher,
			commentToolsCount: commentTools.length,
			totalToolsCount: tools.length,
			toolNames,
		},
		'[MCP] Building humanlayer MCP server',
	)

	// Return null if no tools available (don't register an empty MCP server)
	if (tools.length === 0) {
		logger.info('[MCP] No tools available, not creating MCP server')
		return null
	}

	logger.info({ toolNames }, '[MCP] Creating humanlayer MCP server with tools')
	return createSdkMcpServer({
		name: 'humanlayer',
		tools,
	})
}
