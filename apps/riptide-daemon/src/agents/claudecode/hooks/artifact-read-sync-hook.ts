import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { HookCallback, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import matter from 'gray-matter'
import { hash } from 'ohash'

import { Sentry } from '@/instrument'
import { extractArtifactSubpath, getArtifactSubpathPrefixes, isArtifactTrashPath } from '@/lib/artifact-subpath'
import { type ArtifactSyncLedger, createArtifactSyncLedger, recordSyncedFile } from '@/lib/artifact-sync-ledger'
import {
	buildDesignResolvedTemplateContext,
	computeSha256Hash,
	getMimeType,
	isAlreadySynced,
	isTextFile,
	toArrayBuffer,
} from '@/lib/artifact-sync-utils'
import { ARTIFACT_TRASH_SKIP_CONTEXT } from '@/lib/artifact-trash'
import type { ISyncManager } from '@/lib/sync-service'
import logger from '@/logger'

import { getFilePath, isArtifactPath } from '../whitelist'
import { artifactSyncedNote, getArtifactCloudUrl } from './artifact-url'

export interface ArtifactReadSyncHookDeps {
	getArtifactCloudUrl?: (artifactId: string) => string | undefined
	ledger?: ArtifactSyncLedger
}

/**
 * Creates a PostToolUse hook that syncs artifacts to the database when files in rpi/ are read.
 *
 * Only upserts when the file is NOT already in the artifacts collection with the same content hash.
 * This means:
 * - First read of a file not in the DB → upsert (creates artifact)
 * - Read of a file already in the DB with same content → skip (no-op)
 * - Read of a file in the DB but with different content on disk → upsert (updates artifact)
 *
 * For S3-backed artifacts (non-text files), uses SHA-256 comparison instead of ohash,
 * and routes through uploadS3Artifact instead of the text upsert path.
 *
 * @param syncManager - The session-scoped sync manager for upserting artifacts
 * @param sessionId - The current session ID (for logging)
 * @param cwd - The working directory for path resolution
 */
export function createArtifactReadSyncHook(
	syncManager: ISyncManager,
	sessionId: string,
	cwd: string,
	taskId: string,
	taskSlug: string | null,
	deps: ArtifactReadSyncHookDeps = {},
): HookCallback {
	const getArtifactCloudUrlFn = deps.getArtifactCloudUrl ?? getArtifactCloudUrl
	const ledger = deps.ledger ?? createArtifactSyncLedger()

	return async (
		input: HookInput,
		_toolUseID: string | undefined,
		options: { signal: AbortSignal },
	): Promise<HookJSONOutput> => {
		// Only handle PostToolUse events
		if (input.hook_event_name !== 'PostToolUse') {
			return { continue: true }
		}

		// Extract file path from tool input
		const filePath = getFilePath(input.tool_input)
		if (!filePath) {
			return { continue: true }
		}

		// Only sync files in rpi/ directory
		if (!isArtifactPath(filePath, cwd)) {
			return { continue: true }
		}

		// Check abort signal
		if (options.signal.aborted) {
			return { continue: true }
		}

		try {
			const resolvedFilePath = filePath.startsWith('/') ? filePath : resolve(cwd, filePath)
			const subpathPrefixes = getArtifactSubpathPrefixes(cwd, taskId, taskSlug)
			if (isArtifactTrashPath(resolvedFilePath, subpathPrefixes)) {
				logger.debug({ sessionId, filePath, taskId }, 'Artifact read sync skipped for reserved trash path')
				return {
					continue: true,
					hookSpecificOutput: {
						hookEventName: 'PostToolUse',
						additionalContext: ARTIFACT_TRASH_SKIP_CONTEXT,
					},
				}
			}
			const fileName = extractArtifactSubpath(resolvedFilePath, subpathPrefixes)
			if (!fileName) {
				logger.debug(
					{ sessionId, filePath, taskId, taskSlug },
					'Artifact path did not resolve to a task subpath',
				)
				return { continue: true }
			}

			// Check if this artifact is already tracked in the Electric collection as S3-backed
			const collection = syncManager.getCollection()
			const existingArtifact = collection?.toArray.find((a) => a.file_name === fileName)

			if (existingArtifact?.storage_type === 's3' && !isTextFile(fileName)) {
				// S3-backed artifact: compare SHA-256 hash, skip if unchanged
				const bytes = toArrayBuffer(await readFile(resolvedFilePath))
				const contentHash = await computeSha256Hash(bytes)

				if (existingArtifact.content_hash === contentHash) {
					await recordSyncedFile(ledger, fileName, resolvedFilePath)
					const cloudUrl = getArtifactCloudUrlFn(existingArtifact.id)
					logger.debug({ sessionId, fileName }, 'Artifact read sync skipped: S3 artifact hash matches')
					return {
						continue: true,
						hookSpecificOutput: {
							hookEventName: 'PostToolUse',
							additionalContext: `${artifactSyncedNote(cloudUrl)}`,
						},
					}
				}

				// Hash mismatch on an S3-backed file — re-upload the new content to S3
				const contentType = getMimeType(fileName)
				const { artifactId } = await syncManager.uploadS3Artifact({
					fileName,
					contentType,
					contentHash,
					fileSizeBytes: bytes.byteLength,
					bytes,
				})

				await recordSyncedFile(ledger, fileName, resolvedFilePath)
				const cloudUrl = getArtifactCloudUrlFn(artifactId)
				logger.info(
					{ sessionId, fileName, artifactId, cloudUrl },
					'S3 artifact re-uploaded after hash mismatch on read',
				)
				return {
					continue: true,
					hookSpecificOutput: {
						hookEventName: 'PostToolUse',
						additionalContext: `${artifactSyncedNote(cloudUrl)}`,
					},
				}
			}

			if (!isTextFile(fileName)) {
				// New non-text file not yet in collection — upload to S3
				const bytes = toArrayBuffer(await readFile(resolvedFilePath))
				const contentHash = await computeSha256Hash(bytes)
				const contentType = getMimeType(fileName)

				const { artifactId } = await syncManager.uploadS3Artifact({
					fileName,
					contentType,
					contentHash,
					fileSizeBytes: bytes.byteLength,
					bytes,
				})

				await recordSyncedFile(ledger, fileName, resolvedFilePath)
				const cloudUrl = getArtifactCloudUrlFn(artifactId)
				logger.info({ sessionId, fileName, artifactId, cloudUrl }, 'Binary artifact uploaded to S3 on read')
				return {
					continue: true,
					hookSpecificOutput: {
						hookEventName: 'PostToolUse',
						additionalContext: `${artifactSyncedNote(cloudUrl)}`,
					},
				}
			}

			// Text file — proceed with existing text read + ohash + upsertArtifact path
			const content = await readFile(resolvedFilePath, 'utf-8')
			const contentHash = hash(content)

			// Parse YAML frontmatter from content
			let frontmatter: Record<string, unknown> = {}
			try {
				const { data } = matter(content)
				frontmatter = data
			} catch {
				// Non-blocking: if frontmatter parsing fails, use empty object
			}
			const isDesignDiscussion = frontmatter.type === 'design-discussion'

			// Skip upsert if artifact already exists in collection with same content hash.
			// This avoids creating unnecessary operation log entries on repeated reads.
			const syncStatus = isAlreadySynced(syncManager, fileName, contentHash)
			if (syncStatus.synced && existingArtifact?.storage_type !== 's3' && !isDesignDiscussion) {
				await recordSyncedFile(ledger, fileName, resolvedFilePath)
				logger.debug(
					{ sessionId, fileName },
					'Artifact read sync skipped: already synced with same content hash',
				)
				if (syncStatus.artifactId) {
					const cloudUrl = getArtifactCloudUrlFn(syncStatus.artifactId)
					return {
						continue: true,
						hookSpecificOutput: {
							hookEventName: 'PostToolUse',
							additionalContext: `${artifactSyncedNote(cloudUrl)}`,
						},
					}
				}
				return { continue: true }
			}

			logger.info({ sessionId, filePath }, 'Artifact read sync: upserting (new or changed file)')

			const { artifactId, designQuestionsResolved } = await syncManager.upsertArtifact({
				fileName,
				content,
				frontmatter,
				operationType: 'Read',
				operationContents: input.tool_input as Record<string, unknown>,
			})

			await recordSyncedFile(ledger, fileName, resolvedFilePath)
			const cloudUrl = getArtifactCloudUrlFn(artifactId)
			logger.info(
				{ sessionId, fileName, contentLength: content.length, artifactId, cloudUrl },
				'Artifact read synced successfully',
			)

			return {
				continue: true,
				hookSpecificOutput: {
					hookEventName: 'PostToolUse',
					additionalContext: `${artifactSyncedNote(cloudUrl)}${buildDesignResolvedTemplateContext(designQuestionsResolved, frontmatter?.type as string | undefined)}`,
				},
			}
		} catch (error) {
			if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
				logger.debug({ filePath, sessionId }, 'Artifact file not found, skipping sync')
				return { continue: true }
			}
			// Non-blocking: log error but don't interrupt session
			logger.error({ err: error, sessionId, filePath }, 'Failed to sync artifact on read')
			Sentry.captureException(error, {
				tags: { session_id: sessionId },
				extra: { filePath },
			})
		}

		return { continue: true }
	}
}
