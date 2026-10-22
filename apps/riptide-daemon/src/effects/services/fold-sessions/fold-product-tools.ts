import { defineTool, ToolFailure, type FoldTool } from '@humanlayer/fold-core'
import { Effect, Schema } from 'effect'

import {
	executeGetArtifactCommentsEffect,
	executeGetDiffComments,
	executeLibraryResearcherEffect,
	executeReplyToArtifactCommentEffect,
	executeReplyToDiffComment,
	executeUpdateArtifactCommentsEffect,
	executeUpdateDiffComments,
	type HumanlayerToolInputError,
} from '@/agents/shared/humanlayer-tools/executors'
import { TOOL_DESCRIPTIONS } from '@/agents/shared/humanlayer-tools/schemas'

import type { DaemonTaskCapabilityError } from '../daemon-api/daemon-api.errors'
import { DaemonApi } from '../daemon-api/daemon-api.service'

const ToolResult = Schema.Struct({ content: Schema.String })
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const CommentId = Schema.String.check(Schema.isPattern(/^[0-9a-fA-F]{8,12}$/))

const narrowDaemonApiFailureForTool = <A, R>(
	effect: Effect.Effect<A, DaemonTaskCapabilityError | HumanlayerToolInputError | typeof ToolFailure.Type, R>,
	message: string,
): Effect.Effect<A, typeof ToolFailure.Type, R> =>
	effect.pipe(
		Effect.catchTags({
			DaemonTaskCapabilityError: () => Effect.fail(ToolFailure.make({ text: message })),
			HumanlayerToolInputError: (error) => Effect.fail(ToolFailure.make({ text: error.message })),
		}),
	)

const makeArtifactCommentTools = Effect.fn('fold.tools.make_artifact_comment_tools')(function* (scope: {
	readonly taskId: string
}) {
	const daemonApi = yield* DaemonApi
	return [
		defineTool({
			name: 'get_artifact_comments',
			description: TOOL_DESCRIPTIONS.get_artifact_comments,
			parameters: Schema.Struct({
				artifact_filename: Schema.String,
				include_resolved: Schema.optionalKey(Schema.Boolean),
				limit: Schema.optionalKey(PositiveInt),
				offset: Schema.optionalKey(NonNegativeInt),
			}),
			success: ToolResult,
			failure: ToolFailure,
			handler: (input) =>
				narrowDaemonApiFailureForTool(
					executeGetArtifactCommentsEffect({
						taskId: scope.taskId,
						toolInput: {
							artifact_filename: input.artifact_filename,
							include_resolved: input.include_resolved ?? true,
							offset: input.offset ?? 0,
							limit: input.limit ?? 20,
						},
					}).pipe(
						Effect.map((content) => ToolResult.make({ content })),
						// eslint-disable-next-line anti-slop/no-reprovide-ambient-service -- Fold invokes this fixed tool handler without DaemonApi in its declared environment.
						Effect.provideService(DaemonApi, daemonApi),
					),
					'Failed to fetch artifact comments',
				),
		}),
		defineTool({
			name: 'update_artifact_comments',
			description: TOOL_DESCRIPTIONS.update_artifact_comments,
			parameters: Schema.Struct({
				artifact_filename: Schema.String,
				comment_ids: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
				resolved: Schema.optionalKey(Schema.Boolean),
				deleted: Schema.optionalKey(Schema.Boolean),
			}),
			success: ToolResult,
			failure: ToolFailure,
			handler: (input) =>
				narrowDaemonApiFailureForTool(
					executeUpdateArtifactCommentsEffect({
						taskId: scope.taskId,
						toolInput: {
							artifact_filename: input.artifact_filename,
							comment_ids: [...input.comment_ids],
							resolved: input.resolved,
							deleted: input.deleted,
						},
					}).pipe(
						Effect.map((content) => ToolResult.make({ content })),
						// eslint-disable-next-line anti-slop/no-reprovide-ambient-service -- Fold invokes this fixed tool handler without DaemonApi in its declared environment.
						Effect.provideService(DaemonApi, daemonApi),
					),
					'Failed to update artifact comments',
				),
		}),
		defineTool({
			name: 'reply_to_artifact_comment',
			description: TOOL_DESCRIPTIONS.reply_to_artifact_comment,
			parameters: Schema.Struct({
				artifact_filename: Schema.String,
				comment_id: Schema.String,
				content: Schema.NonEmptyString,
			}),
			success: ToolResult,
			failure: ToolFailure,
			handler: (input) =>
				narrowDaemonApiFailureForTool(
					executeReplyToArtifactCommentEffect({
						taskId: scope.taskId,
						toolInput: {
							artifact_filename: input.artifact_filename,
							comment_id: input.comment_id,
							content: input.content,
						},
					}).pipe(
						Effect.map((content) => ToolResult.make({ content })),
						// eslint-disable-next-line anti-slop/no-reprovide-ambient-service -- Fold invokes this fixed tool handler without DaemonApi in its declared environment.
						Effect.provideService(DaemonApi, daemonApi),
					),
					'Failed to reply to artifact comment',
				),
		}),
	]
})

const makeDiffCommentTools = Effect.fn('fold.tools.make_diff_comment_tools')(function* (scope: {
	readonly taskId: string
}) {
	const daemonApi = yield* DaemonApi
	return [
		defineTool({
			name: 'get_diff_comments',
			description: TOOL_DESCRIPTIONS.get_diff_comments,
			parameters: Schema.Struct({
				include_resolved: Schema.optionalKey(Schema.Boolean),
				limit: Schema.optionalKey(PositiveInt),
				offset: Schema.optionalKey(NonNegativeInt),
			}),
			success: ToolResult,
			failure: ToolFailure,
			handler: (input) =>
				narrowDaemonApiFailureForTool(
					executeGetDiffComments({
						taskId: scope.taskId,
						toolInput: {
							include_resolved: input.include_resolved ?? false,
							offset: input.offset ?? 0,
							limit: input.limit ?? 20,
						},
					}).pipe(
						Effect.map((content) => ToolResult.make({ content })),
						// eslint-disable-next-line anti-slop/no-reprovide-ambient-service -- Fold invokes this fixed tool handler without DaemonApi in its declared environment.
						Effect.provideService(DaemonApi, daemonApi),
					),
					'Failed to fetch diff comments',
				),
		}),
		defineTool({
			name: 'update_diff_comments',
			description: TOOL_DESCRIPTIONS.update_diff_comments,
			parameters: Schema.Struct({
				comment_ids: Schema.Array(CommentId).check(Schema.isMinLength(1)),
				resolved: Schema.optionalKey(Schema.Boolean),
				deleted: Schema.optionalKey(Schema.Literal(true)),
			}),
			success: ToolResult,
			failure: ToolFailure,
			handler: (input) => {
				if (input.resolved === undefined && input.deleted === undefined) {
					return Effect.fail(
						ToolFailure.make({ text: 'At least one of resolved or deleted must be provided' }),
					)
				}
				return narrowDaemonApiFailureForTool(
					executeUpdateDiffComments({
						taskId: scope.taskId,
						toolInput: {
							comment_ids: [...input.comment_ids],
							resolved: input.resolved,
							deleted: input.deleted,
						},
					}).pipe(
						Effect.map((content) => ToolResult.make({ content })),
						// eslint-disable-next-line anti-slop/no-reprovide-ambient-service -- Fold invokes this fixed tool handler without DaemonApi in its declared environment.
						Effect.provideService(DaemonApi, daemonApi),
					),
					'Failed to update diff comments',
				)
			},
		}),
		defineTool({
			name: 'reply_to_diff_comment',
			description: TOOL_DESCRIPTIONS.reply_to_diff_comment,
			parameters: Schema.Struct({ thread_id: CommentId, content: Schema.NonEmptyString }),
			success: ToolResult,
			failure: ToolFailure,
			handler: (input) =>
				narrowDaemonApiFailureForTool(
					executeReplyToDiffComment({
						taskId: scope.taskId,
						toolInput: { thread_id: input.thread_id, content: input.content },
					}).pipe(
						Effect.map((content) => ToolResult.make({ content })),
						// eslint-disable-next-line anti-slop/no-reprovide-ambient-service -- Fold invokes this fixed tool handler without DaemonApi in its declared environment.
						Effect.provideService(DaemonApi, daemonApi),
					),
					'Failed to reply to diff comment',
				),
		}),
	]
})

const makeLibraryResearchTool = Effect.fn('fold.tools.make_library_research_tool')(function* () {
	const daemonApi = yield* DaemonApi
	return defineTool({
		name: 'library_researcher',
		description: TOOL_DESCRIPTIONS.library_researcher,
		parameters: Schema.Struct({
			question: Schema.String,
			package_name: Schema.String,
			language: Schema.String,
		}),
		success: ToolResult,
		failure: ToolFailure,
		handler: (input) =>
			narrowDaemonApiFailureForTool(
				executeLibraryResearcherEffect({
					toolInput: { question: input.question, package_name: input.package_name, language: input.language },
				}).pipe(
					Effect.map((content) => ToolResult.make({ content })),
					// eslint-disable-next-line anti-slop/no-reprovide-ambient-service -- Fold invokes this fixed tool handler without DaemonApi in its declared environment.
					Effect.provideService(DaemonApi, daemonApi),
				),
				'Failed to research library',
			),
	})
})

export const makeFoldHumanLayerTools = Effect.fn('fold.tools.make_humanlayer_tools')(function* (input: {
	readonly taskId: string | null
	readonly enableLibraryResearcher: boolean
}) {
	const tools: Array<FoldTool> = []

	if (input.taskId !== null) {
		const artifactCommentTools = yield* makeArtifactCommentTools({ taskId: input.taskId })
		const diffCommentTools = yield* makeDiffCommentTools({ taskId: input.taskId })
		tools.push(...artifactCommentTools)
		tools.push(...diffCommentTools)
	}

	if (input.enableLibraryResearcher) {
		const libraryResearchTool = yield* makeLibraryResearchTool()
		tools.push(libraryResearchTool)
	}

	return tools
})
