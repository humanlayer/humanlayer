import {
	applyPatchToolContract,
	editToolContract,
	PostToolUseHookDecision,
	readToolContract,
	skillToolContract,
	ToolResultMultipart,
	ToolResultTextPart,
	type PostToolUseHook,
	type PostToolUseHookInput,
	writeToolContract,
} from '@humanlayer/fold-core'
import type { TaskWorkflowType, WorktreeTiming } from '@humanlayer/schemas/effect/taskconfiguration'
import * as Sentry from '@sentry/bun'
import { Cause, Effect, Predicate, Schema } from 'effect'

import { getWorkflowRoutingContext } from '@/agents/claudecode/hooks/workflow-routing-hook'
import { isArtifactPath } from '@/agents/claudecode/whitelist'
import { getArtifactSubpathPrefixes } from '@/lib/artifact-subpath'
import { type ArtifactSyncLedger, createArtifactSyncLedger } from '@/lib/artifact-sync-ledger'
import {
	formatMultiSyncMessage,
	formatSyncMessage,
	getOperationType,
	getTaskArtifactPathsFromApplyPatch,
	isApplyPatchTool,
	isEditTool,
	isReadTool,
	isShellTool,
	isWriteTool,
	resolveToolPath,
	syncFileAtPath,
	syncShellCreatedArtifacts,
	type SyncResult,
} from '@/lib/artifact-sync-utils'
import { recordAttributedAgentActivity } from '@/lib/git/commit-attribution'
import type { ISyncManager } from '@/lib/sync-service-types'

import { DaemonApi } from '../daemon-api/daemon-api.service'
import type { GitCommandRunnerRequirements } from '../task-diff/git-command-runner.service'
import { TaskDiffServiceRegistry } from '../task-diff/task-diff-service-registry.service'

const KeepPostToolUseResult = PostToolUseHookDecision.members[0]
const ReplacePostToolUseResult = PostToolUseHookDecision.members[1]
const keepToolResult = KeepPostToolUseResult.make({})

const appendContextToToolResult = Effect.fn('fold.hooks.append_context_to_tool_result')(function* (input: {
	readonly toolName: string
	readonly result: unknown
	readonly context: string
}) {
	if (input.toolName === skillToolContract.name) {
		const result = yield* Schema.decodeUnknownEffect(skillToolContract.success)(input.result)
		return ReplacePostToolUseResult.make({
			result: { ...result, text: `${result.text}\n\n${input.context}` },
			isFailure: false,
		})
	}
	if (isReadTool(input.toolName)) {
		const result = yield* Schema.decodeUnknownEffect(readToolContract.success)(input.result)
		const contextPart = ToolResultTextPart.make({ text: input.context })
		const content = Predicate.isTagged(result, 'text')
			? [ToolResultTextPart.make({ text: result.text }), contextPart]
			: [...result.content, contextPart]
		return ReplacePostToolUseResult.make({
			result: ToolResultMultipart.make({ content }),
			isFailure: false,
		})
	}
	const contract = isWriteTool(input.toolName)
		? writeToolContract
		: isApplyPatchTool(input.toolName)
			? applyPatchToolContract
			: editToolContract
	const result = yield* Schema.decodeUnknownEffect(contract.success)(input.result)
	return ReplacePostToolUseResult.make({
		result: { ...result, text: `${result.text}\n\n${input.context}` },
		isFailure: false,
	})
})

const decodeFileToolInput = Effect.fn('fold.hooks.decode_file_tool_input')(function* (input: PostToolUseHookInput) {
	if (isReadTool(input.toolName)) {
		const decoded = yield* Schema.decodeUnknownEffect(readToolContract.parameters)(input.executedInput)
		return { path: decoded.path, content: undefined }
	}
	if (isWriteTool(input.toolName)) {
		const decoded = yield* Schema.decodeUnknownEffect(writeToolContract.parameters)(input.executedInput)
		return { path: decoded.path, content: decoded.content }
	}
	const decoded = yield* Schema.decodeUnknownEffect(editToolContract.parameters)(input.executedInput)
	return { path: decoded.path, content: undefined }
})

const runProductHookBestEffort = <E, R>(
	input: { readonly sessionId: string; readonly hookName: string },
	effect: Effect.Effect<typeof PostToolUseHookDecision.Type, E, R>,
): Effect.Effect<typeof PostToolUseHookDecision.Type, never, R> =>
	effect.pipe(
		Effect.catchCause((cause) =>
			Effect.logError('Fold product hook failed', cause).pipe(
				Effect.annotateLogs({ sessionId: input.sessionId, hookName: input.hookName }),
				Effect.andThen(
					Effect.sync(() =>
						Sentry.captureException(Cause.squash(cause), {
							tags: { error_type: 'fold_product_hook', hook_name: input.hookName },
							extra: { cause: Cause.pretty(cause), sessionId: input.sessionId },
						}),
					),
				),
				Effect.as(keepToolResult),
			),
		),
	)

const captureArtifactTicketAttachmentFailure = (input: {
	readonly taskId: string
	readonly ticketProvider: string | null
	readonly cause: Cause.Cause<unknown>
}) =>
	Effect.logError('Fold artifact ticket attachment failed', input.cause).pipe(
		Effect.annotateLogs({ taskId: input.taskId, ticketProvider: input.ticketProvider ?? 'none' }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(Cause.squash(input.cause), {
					tags: {
						error_type: 'fold_artifact_ticket_attachment',
						ticket_provider: input.ticketProvider ?? 'none',
					},
					extra: { cause: Cause.pretty(input.cause), taskId: input.taskId },
				}),
			),
		),
	)

const attachSynchronizedArtifactToTicket = Effect.fn('fold.artifacts.attach_to_ticket')(function* (input: {
	readonly taskId: string
	readonly ticketId: string | null
	readonly ticketProvider: string | null
	readonly result: SyncResult
}) {
	if (input.ticketId === null) return
	const ticketId = input.ticketId
	// Without a cloud origin there is no link to attach.
	const cloudUrl = input.result.cloudUrl
	const daemonApi = yield* DaemonApi
	const attachment = Effect.gen(function* () {
		if (input.ticketProvider === 'linear' && cloudUrl) {
			yield* daemonApi.createLinearAttachment({
				issueId: ticketId,
				url: cloudUrl,
				title: input.result.fileName,
			})
			return
		}
		if (input.ticketProvider === 'jira' && cloudUrl) {
			yield* daemonApi.createJiraRemoteLink({
				issueKey: ticketId,
				url: cloudUrl,
				title: input.result.fileName,
				globalId: `system=codelayer&id=${input.result.artifactId}`,
			})
			return
		}
		if (input.ticketProvider === 'github') {
			yield* daemonApi.syncGitHubArtifactBacklink({ taskId: input.taskId })
		}
	})

	yield* attachment.pipe(
		Effect.catchCause((cause) =>
			captureArtifactTicketAttachmentFailure({
				taskId: input.taskId,
				ticketProvider: input.ticketProvider,
				cause,
			}),
		),
	)
})

const synchronizeWrittenArtifact = Effect.fn('fold.artifacts.synchronize_write')(function* (input: {
	readonly hookInput: PostToolUseHookInput
	readonly syncManager: ISyncManager
	readonly sessionId: string
	readonly workingDirectory: string
	readonly taskId: string
	readonly taskSlug: string | null
	readonly ticketId: string | null
	readonly ticketProvider: string | null
}) {
	if (input.hookInput.isFailure) return keepToolResult
	const prefixes = getArtifactSubpathPrefixes(input.workingDirectory, input.taskId, input.taskSlug)

	if (isApplyPatchTool(input.hookInput.toolName)) {
		if (input.taskSlug === null) return keepToolResult
		const paths = getTaskArtifactPathsFromApplyPatch(
			input.hookInput.executedInput,
			input.workingDirectory,
			input.taskSlug,
		)
		const results = yield* Effect.forEach(
			paths,
			(path) =>
				Effect.tryPromise(() =>
					syncFileAtPath(path, 'Edit', input.syncManager, input.sessionId, prefixes),
				).pipe(
					Effect.tap((result) =>
						attachSynchronizedArtifactToTicket({
							taskId: input.taskId,
							ticketId: input.ticketId,
							ticketProvider: input.ticketProvider,
							result,
						}),
					),
				),
			{ concurrency: 4 },
		)
		if (results.length === 0) return keepToolResult
		return yield* appendContextToToolResult({
			toolName: input.hookInput.toolName,
			result: input.hookInput.result,
			context: formatMultiSyncMessage('', results).trim(),
		})
	}

	if (!isWriteTool(input.hookInput.toolName) && !isEditTool(input.hookInput.toolName)) return keepToolResult
	const fileInput = yield* decodeFileToolInput(input.hookInput)
	const filePath = fileInput.path
	if (!isArtifactPath(filePath, input.workingDirectory)) return keepToolResult
	const operation = getOperationType(input.hookInput.toolName)
	if (operation === undefined) return keepToolResult
	const result = yield* Effect.tryPromise(() =>
		syncFileAtPath(
			resolveToolPath(filePath, input.workingDirectory),
			operation,
			input.syncManager,
			input.sessionId,
			prefixes,
			isWriteTool(input.hookInput.toolName) ? fileInput.content : undefined,
		),
	)
	yield* attachSynchronizedArtifactToTicket({
		taskId: input.taskId,
		ticketId: input.ticketId,
		ticketProvider: input.ticketProvider,
		result,
	})
	return yield* appendContextToToolResult({
		toolName: input.hookInput.toolName,
		result: input.hookInput.result,
		context: formatSyncMessage('', result.cloudUrl, result.designQuestionsResolved, result.documentType).trim(),
	})
})

const synchronizeShellCreatedArtifact = Effect.fn('fold.artifacts.synchronize_shell')(function* (input: {
	readonly hookInput: PostToolUseHookInput
	readonly syncManager: ISyncManager
	readonly sessionId: string
	readonly workingDirectory: string
	readonly taskId: string
	readonly taskSlug: string | null
	readonly ticketId: string | null
	readonly ticketProvider: string | null
	readonly ledger: ArtifactSyncLedger
}) {
	if (input.hookInput.isFailure || !isShellTool(input.hookInput.toolName)) return keepToolResult
	const synced = yield* Effect.tryPromise(() =>
		syncShellCreatedArtifacts({
			syncManager: input.syncManager,
			sessionId: input.sessionId,
			cwd: input.workingDirectory,
			taskId: input.taskId,
			taskSlug: input.taskSlug,
			ledger: input.ledger,
		}),
	)
	yield* Effect.forEach(synced, (result) =>
		attachSynchronizedArtifactToTicket({
			taskId: input.taskId,
			ticketId: input.ticketId,
			ticketProvider: input.ticketProvider,
			result,
		}),
	)
	// A shell tool result is not a write/edit/read shape, so leave the tool output
	// untouched; the files are uploaded, which is what the viewer needs.
	return keepToolResult
})

const synchronizeReadArtifact = Effect.fn('fold.artifacts.synchronize_read')(function* (input: {
	readonly hookInput: PostToolUseHookInput
	readonly syncManager: ISyncManager
	readonly sessionId: string
	readonly workingDirectory: string
	readonly taskId: string
	readonly taskSlug: string | null
}) {
	if (input.hookInput.isFailure || !isReadTool(input.hookInput.toolName)) return keepToolResult
	const fileInput = yield* Schema.decodeUnknownEffect(readToolContract.parameters)(input.hookInput.executedInput)
	const filePath = fileInput.path
	if (!isArtifactPath(filePath, input.workingDirectory)) return keepToolResult
	const result = yield* Effect.tryPromise(() =>
		syncFileAtPath(
			resolveToolPath(filePath, input.workingDirectory),
			'Read',
			input.syncManager,
			input.sessionId,
			getArtifactSubpathPrefixes(input.workingDirectory, input.taskId, input.taskSlug),
		),
	)
	return yield* appendContextToToolResult({
		toolName: input.hookInput.toolName,
		result: input.hookInput.result,
		context: formatSyncMessage('', result.cloudUrl, result.designQuestionsResolved, result.documentType).trim(),
	})
})

export const makeFoldWorkflowRoutingHook = Effect.fn('fold.hooks.make_workflow_routing')(function* (input: {
	readonly sessionId: string
	readonly workflowType: TaskWorkflowType | null
	readonly worktreeTiming: WorktreeTiming | null
	readonly isInWorktree: boolean
}) {
	return {
		name: 'humanlayer-workflow-routing',
		tools: [skillToolContract.name],
		handler: Effect.fn('fold.hooks.route_workflow')((hookInput) =>
			runProductHookBestEffort(
				{ sessionId: input.sessionId, hookName: 'humanlayer-workflow-routing' },
				Effect.gen(function* () {
					const skillInput = yield* Schema.decodeUnknownEffect(skillToolContract.parameters)(
						hookInput.executedInput,
					)
					const context = getWorkflowRoutingContext(
						input.workflowType,
						input.worktreeTiming,
						skillInput.name,
						input.isInWorktree,
					)
					return context === null
						? keepToolResult
						: yield* appendContextToToolResult({
								toolName: hookInput.toolName,
								result: hookInput.result,
								context,
							})
				}),
			),
		),
	} satisfies PostToolUseHook
})

export const makeFoldArtifactWriteSyncHook = Effect.fn('fold.hooks.make_artifact_write_sync')(function* (input: {
	readonly syncManager: ISyncManager
	readonly sessionId: string
	readonly workingDirectory: string
	readonly taskId: string
	readonly taskSlug: string | null
	readonly ticketId: string | null
	readonly ticketProvider: string | null
}) {
	const daemonApi = yield* DaemonApi
	return {
		name: 'humanlayer-artifact-write-sync',
		tools: ['write', 'edit', 'apply_patch'],
		handler: Effect.fn('fold.hooks.synchronize_written_artifact')((hookInput) =>
			runProductHookBestEffort(
				{ sessionId: input.sessionId, hookName: 'humanlayer-artifact-write-sync' },
				synchronizeWrittenArtifact({ ...input, hookInput }).pipe(
					// eslint-disable-next-line anti-slop/no-reprovide-ambient-service -- Fold invokes this fixed post-tool hook without DaemonApi in its declared environment.
					Effect.provideService(DaemonApi, daemonApi),
				),
			),
		),
	} satisfies PostToolUseHook
})

export const makeFoldArtifactReadSyncHook = Effect.fn('fold.hooks.make_artifact_read_sync')(function* (input: {
	readonly syncManager: ISyncManager
	readonly sessionId: string
	readonly workingDirectory: string
	readonly taskId: string
	readonly taskSlug: string | null
}) {
	return {
		name: 'humanlayer-artifact-read-sync',
		tools: [readToolContract.name],
		handler: Effect.fn('fold.hooks.synchronize_read_artifact')((hookInput) =>
			runProductHookBestEffort(
				{ sessionId: input.sessionId, hookName: 'humanlayer-artifact-read-sync' },
				synchronizeReadArtifact({ ...input, hookInput }),
			),
		),
	} satisfies PostToolUseHook
})

export const makeFoldArtifactBashSyncHook = Effect.fn('fold.hooks.make_artifact_bash_sync')(function* (input: {
	readonly syncManager: ISyncManager
	readonly sessionId: string
	readonly workingDirectory: string
	readonly taskId: string
	readonly taskSlug: string | null
	readonly ticketId: string | null
	readonly ticketProvider: string | null
}) {
	const daemonApi = yield* DaemonApi
	const ledger = createArtifactSyncLedger()
	return {
		name: 'humanlayer-artifact-bash-sync',
		tools: ['bash', 'shell'],
		handler: Effect.fn('fold.hooks.synchronize_shell_created_artifact')((hookInput) =>
			runProductHookBestEffort(
				{ sessionId: input.sessionId, hookName: 'humanlayer-artifact-bash-sync' },
				synchronizeShellCreatedArtifact({ ...input, hookInput, ledger }).pipe(
					// eslint-disable-next-line anti-slop/no-reprovide-ambient-service -- Fold invokes this fixed post-tool hook without DaemonApi in its declared environment.
					Effect.provideService(DaemonApi, daemonApi),
				),
			),
		),
	} satisfies PostToolUseHook
})

export const makeFoldCommitAttributionHook = Effect.fn('fold.hooks.make_commit_attribution')(function* (input: {
	readonly sessionId: string
	readonly workingDirectory: string
	readonly recordActivity?: typeof recordAttributedAgentActivity
}) {
	const recordActivity = input.recordActivity ?? recordAttributedAgentActivity
	return {
		name: 'humanlayer-commit-attribution',
		handler: Effect.fn('fold.hooks.record_commit_attribution')((hookInput) => {
			if (hookInput.isFailure) return Effect.succeed(keepToolResult)
			return runProductHookBestEffort(
				{ sessionId: input.sessionId, hookName: 'humanlayer-commit-attribution' },
				Effect.sync(() => {
					recordActivity({
						workingDirectory: input.workingDirectory,
						sessionId: input.sessionId,
						toolName: hookInput.toolName,
						toolInput: hookInput.executedInput,
					})
				}).pipe(Effect.as(keepToolResult)),
			)
		}),
	} satisfies PostToolUseHook
})

export const makeFoldTaskDiffCaptureHook = Effect.fn('fold.hooks.make_task_diff_capture')(function* (input: {
	readonly taskId: string
	readonly sessionId: string
}) {
	const taskDiffServiceRegistry = yield* TaskDiffServiceRegistry
	// Fold's PostToolUseHook contract requires a closed Effect; bind the daemon runtime
	// at this SDK adapter boundary, not in the task-diff operations themselves.
	const taskDiffContext = yield* Effect.context<GitCommandRunnerRequirements>()
	return {
		name: 'humanlayer-task-diff-capture',
		tools: ['write', 'edit', 'apply_patch', 'bash'],
		handler: Effect.fn('fold.hooks.schedule_task_diff_capture')((hookInput) => {
			if (hookInput.isFailure) return Effect.succeed(keepToolResult)
			return runProductHookBestEffort(
				{ sessionId: input.sessionId, hookName: 'humanlayer-task-diff-capture' },
				taskDiffServiceRegistry
					.requestCapture({ taskId: input.taskId, sessionId: input.sessionId })
					.pipe(Effect.as(keepToolResult), Effect.provide(taskDiffContext)),
			)
		}),
	} satisfies PostToolUseHook
})
