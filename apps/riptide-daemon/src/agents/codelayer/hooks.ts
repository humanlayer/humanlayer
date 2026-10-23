/**
 * CodeLayer Agent Hooks
 *
 * PostToolUse hooks for syncing artifacts to the cloud after file operations.
 * Uses shared utilities from ../shared/artifact-sync-utils.ts for:
 * - Tool name normalization (handles both Claude Code and CodeLayer naming)
 * - File syncing (text and binary)
 * - Output formatting
 */

import { readFile } from 'node:fs/promises'

import type { ApprovalHook, DoneResult, PostToolUseHook, PostToolUseHookContext } from '@humanlayer/agentlayer-core'
import type { Session } from '@humanlayer/db/tables/sessions'
import type { TaskWorkflowType, WorktreeTiming } from '@humanlayer/schemas/effect/taskconfiguration'
import { isDefinedError } from '@orpc/client'
import matter from 'gray-matter'

import { Sentry } from '@/instrument'
import { extractArtifactSubpath, getArtifactSubpathPrefixes, isArtifactTrashPath } from '@/lib/artifact-subpath'
import { createArtifactSyncLedger } from '@/lib/artifact-sync-ledger'
import {
	computeSha256Hash,
	computeTextHash,
	extractApplyPatchPaths,
	formatMultiSyncMessage,
	formatSyncMessage,
	getMimeType,
	getOperationType,
	getTaskArtifactPathsFromApplyPatch,
	isAlreadySynced,
	isApplyPatchTool,
	isEditTool,
	isReadTool,
	isShellTool,
	isTextFile,
	isWriteTool,
	resolveToolPath,
	type SyncResult,
	syncFileAtPath,
	syncShellCreatedArtifacts,
} from '@/lib/artifact-sync-utils'
import { formatArtifactTrashSkipMessage } from '@/lib/artifact-trash'
import type { ISyncManager } from '@/lib/sync-service'
import logger from '@/logger'

const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
	buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

import { getArtifactCloudUrl } from '../claudecode/hooks/artifact-url'
import { getWorkflowRoutingContext, getWorkflowRoutingSkillName } from '../claudecode/hooks/workflow-routing-hook'
import type { HookServices } from '../claudecode/types'
import { getFilePath, isArtifactPath } from '../claudecode/whitelist'

function toolOutputToString(output: unknown): string {
	if (typeof output === 'string') return output
	if (typeof output === 'object' && output !== null && 'type' in output) {
		const typedOutput = output as { type: string; value?: unknown; text?: unknown }
		if (typedOutput.type === 'text' && typeof typedOutput.value === 'string') return typedOutput.value
		if (typedOutput.type === 'error-text' && typeof typedOutput.value === 'string') return typedOutput.value
		if (typedOutput.type === 'content' && typeof typedOutput.text === 'string') return typedOutput.text
	}
	return JSON.stringify(output)
}

function isMultimodalOutput(output: unknown): boolean {
	if (typeof output !== 'object' || output === null) return false
	const typedOutput = output as { type?: string; value?: unknown }
	if (typedOutput.type !== 'content' || !Array.isArray(typedOutput.value)) return false
	return typedOutput.value.some(
		(item: unknown) =>
			typeof item === 'object' &&
			item !== null &&
			'type' in item &&
			(item as { type: string }).type === 'image-data',
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Ticket attachment helper
// "Separate the concerns" — Fowler
// ─────────────────────────────────────────────────────────────────────────────

async function attachToTicketTracker(
	result: SyncResult,
	taskId: string,
	ticketId: string | null,
	ticketProvider: string | null,
	services: HookServices,
): Promise<void> {
	if (!ticketId) return
	// Without a cloud origin there is no link to attach.
	const cloudUrl = result.cloudUrl

	if (ticketProvider === 'linear' && cloudUrl) {
		try {
			await services.orpc.integrations.linear.createAttachment({
				issueId: ticketId,
				url: cloudUrl,
				title: result.fileName,
			})
			logger.debug(
				{ ticketId, cloudUrl: result.cloudUrl, fileName: result.fileName },
				'Linear attachment created',
			)
		} catch (err) {
			logger.warn('Failed to create Linear attachment', { err, ticketId })
			Sentry.captureException(err)
		}
	}

	if (ticketProvider === 'jira' && cloudUrl) {
		try {
			await services.orpc.integrations.jira.createRemoteLink({
				issueKey: ticketId,
				url: cloudUrl,
				title: result.fileName,
				globalId: `system=codelayer&id=${result.artifactId}`,
			})
			logger.debug({ issueKey: ticketId, url: result.cloudUrl }, 'Jira remote link attached')
		} catch (err) {
			const defined = isDefinedError(err)
			if (defined && (err as { code: string }).code === 'JIRA_LINK_FAILED') {
				logger.error({ err: (err as { data: unknown }).data, issueKey: ticketId }, 'Jira link failed')
			} else {
				logger.error({ err, issueKey: ticketId }, 'Unexpected Jira error')
			}
			Sentry.captureException(err, { tags: { error_type: 'jira_remote_link_attachment' } })
		}
	}

	if (ticketProvider === 'github') {
		try {
			await services.orpc.integrations.github.syncArtifactBacklink({ taskId })
			logger.debug({ taskId }, 'GitHub artifact backlink synchronized')
		} catch (err) {
			logger.warn({ err, taskId }, 'Failed to synchronize GitHub artifact backlink')
			Sentry.captureException(err, { tags: { error_type: 'github_artifact_backlink' } })
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Approval Hook (simple pass-through)
// ─────────────────────────────────────────────────────────────────────────────

export function createCodelayerApprovalHook(_services: HookServices, _session: Session, _cwd: string): ApprovalHook {
	return (ctx) => ctx.next()
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Routing Hook
// ─────────────────────────────────────────────────────────────────────────────

export function createCodelayerWorkflowRoutingHook(
	workflowType: TaskWorkflowType | null,
	worktreeTiming: WorktreeTiming | null = null,
	isInWorktree = false,
): PostToolUseHook {
	return (ctx) => {
		const skillName = getWorkflowRoutingSkillName(ctx.toolName, ctx.input)
		const routingContext = getWorkflowRoutingContext(workflowType, worktreeTiming, skillName, isInWorktree)

		if (!routingContext) {
			return ctx.done()
		}

		return ctx.done(`${toolOutputToString(ctx.output)}\n\n${routingContext}`)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Write/Edit Sync Hook
// "The composed method should read like a series of steps" — Fowler
// Handles: write, edit, multi_edit, apply_patch
// ─────────────────────────────────────────────────────────────────────────────

export function createCodelayerArtifactSyncHook(
	syncManager: ISyncManager,
	sessionId: string,
	cwd: string,
	taskId: string,
	taskSlug: string | null,
	ticketId: string | null,
	ticketProvider: string | null,
	services: HookServices,
): PostToolUseHook {
	logger.debug({ sessionId, cwd, taskId, taskSlug, ticketId, ticketProvider }, 'CodeLayer artifact sync hook created')

	const artifactSubpathPrefixes = getArtifactSubpathPrefixes(cwd, taskId, taskSlug)
	const shellLedger = createArtifactSyncLedger()

	return async (ctx) => {
		const toolName = ctx.toolName

		// Shell commands (cp, screenshots, scripts) leave files with no tool input
		// naming them; diff the task directory to catch them.
		if (isShellTool(toolName)) {
			try {
				const synced = await syncShellCreatedArtifacts({
					syncManager,
					sessionId,
					cwd,
					taskId,
					taskSlug,
					ledger: shellLedger,
				})
				if (synced.length === 0) return ctx.done()
				for (const result of synced) {
					await attachToTicketTracker(result, taskId, ticketId, ticketProvider, services)
				}
				if (isMultimodalOutput(ctx.output)) return ctx.done()
				return ctx.done(formatMultiSyncMessage(toolOutputToString(ctx.output), synced))
			} catch (error) {
				logger.error({ err: error, sessionId, taskId }, 'Artifact directory scan after shell command failed')
				Sentry.captureException(error, { tags: { session_id: sessionId } })
				return ctx.done()
			}
		}

		// Handle apply_patch: sync only artifact files referenced in the patch
		if (isApplyPatchTool(toolName)) {
			if (!taskSlug) {
				logger.debug({ sessionId }, 'apply_patch skipped: no task slug')
				return ctx.done()
			}
			return handleApplyPatch(
				ctx,
				syncManager,
				sessionId,
				cwd,
				taskSlug,
				artifactSubpathPrefixes,
				ticketId,
				ticketProvider,
				taskId,
				services,
			)
		}

		// Only handle write/edit tools
		if (!isWriteTool(toolName) && !isEditTool(toolName)) {
			return ctx.done()
		}

		const filePath = getFilePath(ctx.input)
		if (!filePath || !isArtifactPath(filePath, cwd)) {
			return ctx.done()
		}
		const resolvedFilePath = resolveToolPath(filePath, cwd)
		if (isArtifactTrashPath(resolvedFilePath, artifactSubpathPrefixes)) {
			logger.debug({ sessionId, filePath, taskId }, 'Artifact sync skipped for reserved trash path')
			if (isMultimodalOutput(ctx.output)) return ctx.done()
			return ctx.done(formatArtifactTrashSkipMessage(toolOutputToString(ctx.output)))
		}

		const operationType = getOperationType(toolName)
		if (!operationType) {
			return ctx.done()
		}

		logger.info({ sessionId, filePath, toolName, operationType }, 'Artifact sync triggered')

		try {
			// For Write, get content from input; for Edit, read from disk
			let providedContent: string | undefined
			if (isWriteTool(toolName)) {
				const inputContent = (ctx.input as { content?: unknown }).content
				if (typeof inputContent !== 'string') {
					logger.warn({ sessionId, filePath }, 'Write tool missing content')
					return ctx.done()
				}
				providedContent = inputContent
			}

			const result = await syncFileAtPath(
				resolvedFilePath,
				operationType,
				syncManager,
				sessionId,
				artifactSubpathPrefixes,
				providedContent,
			)

			await attachToTicketTracker(result, taskId, ticketId, ticketProvider, services)

			return ctx.done(
				formatSyncMessage(
					toolOutputToString(ctx.output),
					result.cloudUrl,
					result.designQuestionsResolved,
					result.documentType,
				),
			)
		} catch (error) {
			if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
				logger.debug({ filePath, sessionId }, 'Artifact file not found, skipping')
				return ctx.done()
			}
			logger.error({ err: error, sessionId, filePath, toolName }, 'Artifact sync failed')
			Sentry.captureException(error, { tags: { session_id: sessionId }, extra: { filePath, toolName } })
			return ctx.done()
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// apply_patch handler
// Syncs only artifact files referenced by the patch text
// ─────────────────────────────────────────────────────────────────────────────

async function handleApplyPatch(
	ctx: {
		input: Record<string, unknown>
		output: PostToolUseHookContext['output']
		done: PostToolUseHookContext['done']
	},
	syncManager: ISyncManager,
	sessionId: string,
	cwd: string,
	taskSlug: string,
	artifactSubpathPrefixes: string[],
	ticketId: string | null,
	ticketProvider: string | null,
	taskId: string,
	services: HookServices,
): Promise<DoneResult> {
	logger.info({ sessionId, taskSlug }, 'apply_patch detected, filtering artifact paths from patch text')

	try {
		const trashPathReferenced = extractApplyPatchPaths(ctx.input)
			.map((filePath) => resolveToolPath(filePath, cwd))
			.some((filePath) => isArtifactTrashPath(filePath, artifactSubpathPrefixes))
		const artifactFiles = getTaskArtifactPathsFromApplyPatch(ctx.input, cwd, taskSlug)
		if (artifactFiles.length === 0) {
			logger.debug({ sessionId, taskSlug }, 'No artifact files referenced by apply_patch')
			return trashPathReferenced
				? ctx.done(formatArtifactTrashSkipMessage(toolOutputToString(ctx.output)))
				: ctx.done()
		}

		const settledResults = await Promise.all(
			artifactFiles.map(async (filePath) => {
				try {
					const result = await syncFileAtPath(
						filePath,
						'Edit',
						syncManager,
						sessionId,
						artifactSubpathPrefixes,
					)
					await attachToTicketTracker(result, taskId, ticketId, ticketProvider, services)
					return result
				} catch (err) {
					logger.warn({ err, filePath, sessionId }, 'Failed to sync artifact file after apply_patch')
					return null
				}
			}),
		)
		const results = settledResults.filter((result): result is SyncResult => result !== null)

		if (results.length === 0) {
			return trashPathReferenced
				? ctx.done(formatArtifactTrashSkipMessage(toolOutputToString(ctx.output)))
				: ctx.done()
		}

		logger.info({ sessionId, syncedCount: results.length }, 'apply_patch artifact sync complete')
		const output = formatMultiSyncMessage(toolOutputToString(ctx.output), results)
		return ctx.done(trashPathReferenced ? formatArtifactTrashSkipMessage(output) : output)
	} catch (error) {
		logger.error({ err: error, sessionId }, 'apply_patch artifact scan failed')
		Sentry.captureException(error, { tags: { session_id: sessionId } })
		return ctx.done()
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Read Sync Hook
// Syncs artifacts when files in artifact directories are read
// ─────────────────────────────────────────────────────────────────────────────

export function createCodelayerArtifactReadSyncHook(
	syncManager: ISyncManager,
	sessionId: string,
	cwd: string,
	taskId: string,
	taskSlug: string | null,
): PostToolUseHook {
	logger.debug({ sessionId, cwd, taskId, taskSlug }, 'CodeLayer artifact read sync hook created')
	const artifactSubpathPrefixes = getArtifactSubpathPrefixes(cwd, taskId, taskSlug)

	return async (ctx) => {
		if (!isReadTool(ctx.toolName)) {
			return ctx.done()
		}

		const filePath = getFilePath(ctx.input)
		if (!filePath || !isArtifactPath(filePath, cwd)) {
			return ctx.done()
		}
		const resolvedFilePath = resolveToolPath(filePath, cwd)
		if (isArtifactTrashPath(resolvedFilePath, artifactSubpathPrefixes)) {
			logger.debug({ sessionId, filePath, taskId }, 'Artifact read sync skipped for reserved trash path')
			if (isMultimodalOutput(ctx.output)) return ctx.done()
			return ctx.done(formatArtifactTrashSkipMessage(toolOutputToString(ctx.output)))
		}

		logger.info({ sessionId, filePath }, 'Artifact read sync triggered')

		try {
			const fileName = extractArtifactSubpath(resolvedFilePath, artifactSubpathPrefixes)
			if (!fileName) {
				logger.debug(
					{ sessionId, filePath, taskId, taskSlug },
					'Artifact path did not resolve to a task subpath',
				)
				return ctx.done()
			}

			// Check for existing S3-backed artifact
			const collection = syncManager.getCollection()
			const existingArtifact = collection?.toArray.find((a) => a.file_name === fileName)

			if (existingArtifact?.storage_type === 's3' && !isTextFile(fileName)) {
				return handleS3ArtifactRead(ctx, resolvedFilePath, fileName, existingArtifact, syncManager, sessionId)
			}

			if (!isTextFile(fileName)) {
				const result = await syncFileAtPath(
					resolvedFilePath,
					'Read',
					syncManager,
					sessionId,
					artifactSubpathPrefixes,
				)
				// Don't mutate multimodal outputs (e.g., image data) - can't append text to binary content
				if (isMultimodalOutput(ctx.output)) {
					return ctx.done()
				}
				return ctx.done(
					formatSyncMessage(
						toolOutputToString(ctx.output),
						result.cloudUrl,
						result.designQuestionsResolved,
						result.documentType,
					),
				)
			}

			// Text file: check if already synced with same hash
			const content = await readFile(resolvedFilePath, 'utf-8')
			const contentHash = computeTextHash(content)
			let frontmatter: Record<string, unknown> = {}
			try {
				const { data } = matter(content)
				frontmatter = data
			} catch {
				// Non-blocking: if frontmatter parsing fails, use empty object
			}
			const isDesignDiscussion = frontmatter.type === 'design-discussion'

			const syncStatus = isAlreadySynced(syncManager, fileName, contentHash)
			if (
				syncStatus.synced &&
				syncStatus.artifactId &&
				existingArtifact?.storage_type !== 's3' &&
				!isDesignDiscussion
			) {
				const cloudUrl = getArtifactCloudUrl(syncStatus.artifactId)
				logger.debug({ sessionId, fileName }, 'Artifact already synced with same hash')
				return ctx.done(formatSyncMessage(toolOutputToString(ctx.output), cloudUrl))
			}

			const result = await syncFileAtPath(
				resolvedFilePath,
				'Read',
				syncManager,
				sessionId,
				artifactSubpathPrefixes,
				content,
			)
			return ctx.done(
				formatSyncMessage(
					toolOutputToString(ctx.output),
					result.cloudUrl,
					result.designQuestionsResolved,
					result.documentType,
				),
			)
		} catch (error) {
			if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
				logger.debug({ filePath, sessionId }, 'Artifact file not found, skipping')
				return ctx.done()
			}
			logger.error({ err: error, sessionId, filePath }, 'Artifact read sync failed')
			Sentry.captureException(error, { tags: { session_id: sessionId }, extra: { filePath } })
			return ctx.done()
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// S3 artifact read handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleS3ArtifactRead(
	ctx: { output: PostToolUseHookContext['output']; done: PostToolUseHookContext['done'] },
	filePath: string,
	fileName: string,
	existingArtifact: { id: string; content_hash: string | null },
	syncManager: ISyncManager,
	sessionId: string,
): Promise<DoneResult> {
	const bytes = toArrayBuffer(await readFile(filePath))
	const contentHash = await computeSha256Hash(bytes)

	// Don't mutate multimodal outputs (e.g., image data) - can't append text to binary content
	const skipMutation = isMultimodalOutput(ctx.output)

	// Hash matches - already synced
	if (existingArtifact.content_hash === contentHash) {
		const cloudUrl = getArtifactCloudUrl(existingArtifact.id)
		logger.debug({ sessionId, fileName }, 'S3 artifact hash matches, skipping re-upload')
		if (skipMutation) return ctx.done()
		return ctx.done(formatSyncMessage(toolOutputToString(ctx.output), cloudUrl))
	}

	// Hash mismatch - re-upload
	const contentType = getMimeType(fileName)
	const { artifactId } = await syncManager.uploadS3Artifact({
		fileName,
		contentType,
		contentHash,
		fileSizeBytes: bytes.byteLength,
		bytes,
	})

	const cloudUrl = getArtifactCloudUrl(artifactId)
	logger.info({ sessionId, fileName, artifactId, cloudUrl }, 'S3 artifact re-uploaded after hash mismatch')
	if (skipMutation) return ctx.done()
	return ctx.done(formatSyncMessage(toolOutputToString(ctx.output), cloudUrl))
}
