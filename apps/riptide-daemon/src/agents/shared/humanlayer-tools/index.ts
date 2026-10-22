/**
 * HumanLayer tools for both MCP server (Claude Code) and CodeLayer agent.
 *
 * Architecture:
 * - schemas.ts: Shared Zod schemas for inputs
 * - executors.ts: Shared execution logic and formatters
 * - codelayer-tools.ts: CodeLayer agent tool factories using defineTool
 * - mcp-tools.ts: MCP server tool factories using Claude SDK tool()
 */

// CodeLayer tools
export {
	type CommentToolsOptions,
	createCommentTools,
	createDiffCommentTools,
	createHumanlayerTools,
	createLibraryResearcherTool,
	type HumanlayerToolsOptions,
	type DiffCommentToolsOptions,
	type LibraryResearcherToolOptions,
} from './codelayer-tools'

// Executors
export {
	buildCommentsOutput,
	type CommentItem,
	type ExecutorResult,
	executeGetArtifactComments,
	executeGetDiffComments,
	executeLibraryResearcher,
	executeReplyToArtifactComment,
	executeReplyToDiffComment,
	executeUpdateArtifactComments,
	executeUpdateDiffComments,
	formatDiffCommentsPage,
	formatDiffCommentToolError,
	formatErrorWithArtifacts,
	type RunDiffCommentToolEffect,
} from './executors'
// Schemas
export {
	type GetArtifactCommentsInput,
	GetArtifactCommentsInputSchema,
	type GetDiffCommentsInput,
	GetDiffCommentsInputSchema,
	type LibraryResearcherInput,
	LibraryResearcherInputSchema,
	type ReplyToArtifactCommentInput,
	ReplyToArtifactCommentInputSchema,
	type ReplyToDiffCommentInput,
	ReplyToDiffCommentInputSchema,
	TOOL_DESCRIPTIONS,
	type UpdateArtifactCommentsInput,
	UpdateArtifactCommentsInputSchema,
	type UpdateDiffCommentsInput,
	UpdateDiffCommentsInputSchema,
} from './schemas'
