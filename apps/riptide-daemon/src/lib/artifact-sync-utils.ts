/**
 * Shared utilities for artifact sync hooks.
 *
 * "When you see code that can be grouped together, extract it into a method.
 *  When the same code structure appears in more than one place, extract it
 *  into a common module." — Martin Fowler
 *
 * This module provides:
 * - Tool name normalization (handles both Claude Code and CodeLayer naming)
 * - Operation type mapping (maps tool names to database operation types)
 * - Content hashing utilities
 * - MIME type detection
 * - Output formatting for system reminders
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

import { getMimeType, isTextFile } from '@humanlayer/session-sdk-artifacts'
import matter from 'gray-matter'
import { hash } from 'ohash'

import { artifactLinkLine, artifactSyncedNote, getArtifactCloudUrl } from '@/agents/claudecode/hooks/artifact-url'
import { getArtifactStoragePath, getArtifactSymlinkPath } from '@/lib/artifact-paths'
import { extractArtifactSubpath, getArtifactSubpathPrefixes } from '@/lib/artifact-subpath'
import { type ArtifactSyncLedger, readFileFingerprint } from '@/lib/artifact-sync-ledger'
import { ARTIFACT_TRASH_DIRECTORY } from '@/lib/artifact-trash'
import type { ISyncManager } from '@/lib/sync-service'
import logger from '@/logger'

export const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
	buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

// ─────────────────────────────────────────────────────────────────────────────
// Type definitions
// ─────────────────────────────────────────────────────────────────────────────

/** Database operation types - what gets stored in artifact_operations_log */
export type OperationType = 'Read' | 'Write' | 'Edit' | 'MultiEdit'

/** Result from syncing a single file */
export interface SyncResult {
	artifactId: string
	cloudUrl: string | undefined
	fileName: string
	designQuestionsResolved?: boolean
	documentType?: string
}

/** Document types that support design question resolution detection */
export type DesignDocumentType = 'design-discussion' | 'design-prd' | 'design-tdd'

/** Template paths for resolved design documents by type */
const RESOLVED_TEMPLATE_PATHS: Record<DesignDocumentType, string> = {
	'design-discussion': 'design_discussion_final_answer_resolved.md',
	'design-prd': 'prd_final_answer_resolved.md',
	'design-tdd': 'tdd_final_answer_resolved.md',
}

const INTERACTIVE_QUESTION_DOCUMENT_TYPES = new Set(['design-prd', 'design-tdd'])

function getResolvedTemplateInstruction(documentType?: string): string {
	const templatePath =
		documentType && documentType in RESOLVED_TEMPLATE_PATHS
			? RESOLVED_TEMPLATE_PATHS[documentType as DesignDocumentType]
			: RESOLVED_TEMPLATE_PATHS['design-discussion']
	return `No open design questions remain.
- If the user's latest request was to create this document or answer its remaining open questions, read the completion template at \`{SKILLBASE}/references/${templatePath}\` and follow it after completing that request.
- If the user requested an edit, correction, clarification, or further discussion of an existing document, respond to that request instead. Having zero open questions is not a reason to repeat the completion template.
- If you already gave the completion response in this conversation, do not repeat it unless the user asks for next steps.`
}

export function buildDesignResolvedTemplateContext(designQuestionsResolved?: boolean, documentType?: string): string {
	if (designQuestionsResolved !== true) return ''
	if (documentType && INTERACTIVE_QUESTION_DOCUMENT_TYPES.has(documentType)) return ''
	return `\n\n${getResolvedTemplateInstruction(documentType)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool name normalization
// "Replace Magic Literal with Symbolic Constant" + "Replace Conditional with Polymorphism"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a tool name to lowercase with punctuation removed.
 * This allows matching tool names regardless of agent convention:
 * - Claude Code: Read, Write, Edit, MultiEdit, apply_patch
 * - CodeLayer: read, write, edit, multi_edit, apply_patch
 */
export function normalizeToolName(toolName: string): string {
	return toolName.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Tool names that represent write operations */
const WRITE_TOOLS = new Set(['write'])

/** Tool names that represent read operations */
const READ_TOOLS = new Set(['read'])

/** Tool names that represent edit operations (including multi-edit and patches) */
const EDIT_TOOLS = new Set(['edit', 'multiedit', 'applypatch'])

/** Tool names that represent an arbitrary shell command. */
const SHELL_TOOLS = new Set(['bash', 'shell'])

/**
 * Check if a tool name represents a write operation.
 * Works for both Claude Code (Write) and CodeLayer (write).
 */
export function isWriteTool(toolName: string): boolean {
	return WRITE_TOOLS.has(normalizeToolName(toolName))
}

/**
 * Check if a tool name represents a read operation.
 * Works for both Claude Code (Read) and CodeLayer (read).
 */
export function isReadTool(toolName: string): boolean {
	return READ_TOOLS.has(normalizeToolName(toolName))
}

/**
 * Check if a tool name represents an edit operation (includes multi-edit and apply_patch).
 * Works for both Claude Code and CodeLayer conventions.
 */
export function isEditTool(toolName: string): boolean {
	return EDIT_TOOLS.has(normalizeToolName(toolName))
}

/**
 * Check if a tool name represents an apply_patch operation.
 */
export function isApplyPatchTool(toolName: string): boolean {
	return normalizeToolName(toolName) === 'applypatch'
}

/**
 * Check if a tool name represents a shell operation.
 * Shell hooks intentionally capture after read-only commands too; Git determines whether anything changed.
 */
export function isShellTool(toolName: string): boolean {
	return SHELL_TOOLS.has(normalizeToolName(toolName))
}

/**
 * Map a tool name to a database operation type.
 * Returns undefined if the tool is not a file operation.
 */
export function getOperationType(toolName: string): OperationType | undefined {
	const normalized = normalizeToolName(toolName)
	if (WRITE_TOOLS.has(normalized)) return 'Write'
	if (READ_TOOLS.has(normalized)) return 'Read'
	if (EDIT_TOOLS.has(normalized)) return 'Edit'
	return undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// File utilities
// ─────────────────────────────────────────────────────────────────────────────

export function resolveToolPath(filePath: string, cwd: string): string {
	return isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
}

/**
 * Extract file paths from apply_patch tool input.
 * Returns the paths exactly as they appear in the patch text.
 */
export function extractApplyPatchPaths(toolInput: unknown): string[] {
	if (typeof toolInput !== 'object' || toolInput === null) {
		return []
	}

	const input = toolInput as Record<string, unknown>
	const patchText = input.patch_text ?? input.patchText

	if (typeof patchText !== 'string') {
		return []
	}

	const paths: string[] = []
	let lastPathIndex = -1

	for (const line of patchText.split('\n')) {
		const actionMatch = line.match(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+)$/)
		if (actionMatch?.[1]) {
			paths.push(actionMatch[1].trim())
			lastPathIndex = paths.length - 1
			continue
		}

		const moveMatch = line.match(/^\*\*\*\s+Move to:\s*(.+)$/)
		if (moveMatch?.[1]) {
			const nextPath = moveMatch[1].trim()
			if (lastPathIndex >= 0) {
				paths[lastPathIndex] = nextPath
			} else {
				paths.push(nextPath)
				lastPathIndex = paths.length - 1
			}
		}
	}

	return [...new Set(paths)]
}

/**
 * Extract the current task's artifact file paths referenced by apply_patch.
 * Only paths inside .humanlayer/tasks/<taskSlug>/ are returned.
 */
export function getTaskArtifactPathsFromApplyPatch(toolInput: unknown, cwd: string, taskSlug: string): string[] {
	const taskArtifactDir = getArtifactSymlinkPath(cwd, taskSlug)

	return extractApplyPatchPaths(toolInput)
		.map((filePath) => resolveToolPath(filePath, cwd))
		.filter((filePath) => extractArtifactSubpath(filePath, [taskArtifactDir]) !== null)
}

export async function computeSha256Hash(bytes: ArrayBuffer): Promise<string> {
	const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
}

/**
 * Hash a file the way the cloud stores its content_hash: ohash for text
 * artifacts, SHA-256 hex for S3-backed binaries.
 */
export async function computeFileContentHash(filePath: string, fileName: string): Promise<string> {
	if (isTextFile(fileName)) return hash(await readFile(filePath, 'utf-8'))
	return computeSha256Hash(toArrayBuffer(await readFile(filePath)))
}

export async function hasMatchingCloudContent(
	syncManager: ISyncManager,
	fileName: string,
	filePath: string,
): Promise<boolean> {
	const existing = syncManager.getCollection()?.toArray.find((artifact) => artifact.file_name === fileName)
	if (!existing) return false
	return existing.content_hash === (await computeFileContentHash(filePath, fileName))
}

// ─────────────────────────────────────────────────────────────────────────────
// Output formatting
// "Extract Method: consolidate duplicated formatting logic"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a sync message that appends to the original tool output.
 * Uses system-reminder tag to provide context without disrupting the output.
 */
export function formatSyncMessage(
	originalOutput: string,
	cloudUrl: string | undefined,
	designQuestionsResolved?: boolean,
	documentType?: string,
): string {
	return `${originalOutput}\n\n<system-reminder>\n${artifactSyncedNote(cloudUrl)}${buildDesignResolvedTemplateContext(designQuestionsResolved, documentType)}\n</system-reminder>`
}

/**
 * Format a sync message for multiple artifacts (e.g., after apply_patch).
 */
export function formatMultiSyncMessage(originalOutput: string, results: SyncResult[]): string {
	if (results.length === 0) return originalOutput
	if (results.length === 1) {
		const result = results[0]
		if (result === undefined) return originalOutput
		return formatSyncMessage(originalOutput, result.cloudUrl, result.designQuestionsResolved, result.documentType)
	}

	const links = results.map((r) => artifactLinkLine(r.fileName, r.cloudUrl)).join('\n')
	// Find the first resolved design document to get its type for template context
	const resolvedResult = results.find((result) => result.designQuestionsResolved === true)
	const designResolvedContext = resolvedResult
		? buildDesignResolvedTemplateContext(true, resolvedResult.documentType)
		: ''
	return `${originalOutput}\n\n<system-reminder>\nArtifacts synced to cloud:\n${links}${designResolvedContext}\n</system-reminder>`
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync operations
// "Compose Method: methods should do one thing and do it well"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sync a binary file to S3.
 */
export async function syncBinaryFile(
	filePath: string,
	fileName: string,
	syncManager: ISyncManager,
	sessionId: string,
): Promise<SyncResult> {
	const bytes = toArrayBuffer(await readFile(filePath))
	const contentHash = await computeSha256Hash(bytes)
	const contentType = getMimeType(fileName)

	const { artifactId } = await syncManager.uploadS3Artifact({
		fileName,
		contentType,
		contentHash,
		fileSizeBytes: bytes.byteLength,
		bytes,
	})

	const cloudUrl = getArtifactCloudUrl(artifactId)
	logger.info({ sessionId, fileName, artifactId, cloudUrl, contentType }, 'Binary artifact uploaded to S3')

	return { artifactId, cloudUrl, fileName }
}

/**
 * Sync a text file to the database.
 */
export async function syncTextFile(
	_filePath: string,
	fileName: string,
	content: string,
	operationType: OperationType,
	operationContents: Record<string, unknown>,
	syncManager: ISyncManager,
	sessionId: string,
): Promise<SyncResult> {
	// Parse YAML frontmatter
	let frontmatter: Record<string, unknown> = {}
	try {
		const { data } = matter(content)
		frontmatter = data
	} catch {
		// Non-blocking: if frontmatter parsing fails, use empty object
	}

	const { artifactId, designQuestionsResolved } = await syncManager.upsertArtifact({
		fileName,
		content,
		frontmatter,
		operationType,
		operationContents,
	})

	const cloudUrl = getArtifactCloudUrl(artifactId)
	logger.info(
		{ sessionId, fileName, operationType, contentLength: content.length, artifactId, cloudUrl },
		'Text artifact synced',
	)

	const documentType = typeof frontmatter.type === 'string' ? frontmatter.type : undefined
	return { artifactId, cloudUrl, fileName, designQuestionsResolved, documentType }
}

/**
 * Sync a file at the given path - automatically handles text vs binary.
 */
export async function syncFileAtPath(
	filePath: string,
	operationType: OperationType,
	syncManager: ISyncManager,
	sessionId: string,
	artifactSubpathPrefixes: string[],
	/** For Write, pass the content directly; for Edit/Read, we read from disk */
	providedContent?: string,
	operationContents: Record<string, unknown> = { file_path: filePath },
): Promise<SyncResult> {
	const fileName = extractArtifactSubpath(filePath, artifactSubpathPrefixes)
	if (!fileName) {
		throw new Error(`File path is not within an artifact directory: ${filePath}`)
	}

	if (!isTextFile(fileName)) {
		return syncBinaryFile(filePath, fileName, syncManager, sessionId)
	}

	const content = providedContent ?? (await readFile(filePath, 'utf-8'))
	return syncTextFile(filePath, fileName, content, operationType, operationContents, syncManager, sessionId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if an artifact is already synced with the same content hash.
 * Returns { synced: true, artifactId } if already synced — no upsert needed.
 */
export function isAlreadySynced(
	syncManager: ISyncManager,
	fileName: string,
	contentHash: string,
): { synced: boolean; artifactId?: string } {
	const collection = syncManager.getCollection()
	if (!collection) return { synced: false }

	for (const artifact of collection.toArray) {
		if (artifact.file_name === fileName) {
			if (artifact.content_hash === contentHash) {
				return { synced: true, artifactId: artifact.id }
			}
			return { synced: false }
		}
	}

	return { synced: false }
}

// ─────────────────────────────────────────────────────────────────────────────
// Directory scanning (for apply_patch)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan the task's artifact directory and return all file paths.
 * Used by apply_patch to sync all files that may have been created/modified.
 *
 * Only scans the specific task directory (.humanlayer/tasks/<taskSlug>),
 * NOT the entire .humanlayer/tasks/ or rpi/ directories.
 *
 * @param cwd - Working directory
 * @param taskSlug - The task slug (required to identify the specific task directory)
 * @returns Array of absolute file paths in the task directory
 */
export async function scanTaskArtifactDirectory(cwd: string, taskSlug: string): Promise<string[]> {
	const artifactPaths: string[] = []

	// Only scan the specific task directory via the symlink path
	const taskDir = getArtifactSymlinkPath(cwd, taskSlug)
	try {
		const taskDirStat = await stat(taskDir)
		if (taskDirStat.isDirectory()) {
			await collectFilesRecursively(taskDir, artifactPaths, true)
		}
	} catch {
		// Directory doesn't exist, skip
		logger.debug({ cwd, taskSlug, taskDir }, 'Task artifact directory not found')
	}

	return artifactPaths
}

async function collectFilesRecursively(dir: string, results: string[], isTaskRoot: boolean): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true })
	for (const entry of entries) {
		const fullPath = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (isTaskRoot && entry.name === ARTIFACT_TRASH_DIRECTORY) continue
			await collectFilesRecursively(fullPath, results, false)
		} else if (entry.isFile()) {
			results.push(fullPath)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell-created artifact sync (bash/shell tools)
//
// The write/edit/read hooks only see files an agent touched through those tools.
// Files that arrive in the task directory via a shell command (cp, a screenshot
// tool, a script) carry no tool input naming them, so the shell hooks diff the
// task directory instead. Shared by the Claude, Codex, and Fold runtimes.
// ─────────────────────────────────────────────────────────────────────────────

interface TaskArtifactFile {
	fileName: string
	path: string
	fingerprint: string
}

function taskArtifactRoots(cwd: string, taskId: string, taskSlug: string | null): string[] {
	const roots = [getArtifactStoragePath(taskId)]
	if (taskSlug) roots.unshift(getArtifactSymlinkPath(cwd, taskSlug))
	if (taskSlug) roots.push(resolve(cwd, 'rpi', 'tasks', taskSlug))
	return roots
}

async function listTaskArtifactFiles(roots: string[], subpathPrefixes: string[]): Promise<TaskArtifactFile[]> {
	const byFileName = new Map<string, TaskArtifactFile>()
	for (const root of roots) {
		const rootStat = await stat(root).catch(() => null)
		if (!rootStat?.isDirectory()) continue
		const paths: string[] = []
		await collectFilesRecursively(root, paths, true)
		for (const path of paths) {
			const fileName = extractArtifactSubpath(path, subpathPrefixes)
			if (!fileName || byFileName.has(fileName)) continue
			byFileName.set(fileName, { fileName, path, fingerprint: await readFileFingerprint(path) })
		}
	}
	return [...byFileName.values()]
}

/**
 * Upload artifacts that appeared in the task directory but the cloud does not
 * yet have. Skips files whose fingerprint the ledger already knows and files
 * whose content the cloud already stores, so repeated shell commands are cheap
 * and no upload is duplicated.
 */
export async function syncShellCreatedArtifacts(params: {
	syncManager: ISyncManager
	sessionId: string
	cwd: string
	taskId: string
	taskSlug: string | null
	ledger: ArtifactSyncLedger
	signal?: AbortSignal
}): Promise<SyncResult[]> {
	const { syncManager, sessionId, cwd, taskId, taskSlug, ledger, signal } = params
	const subpathPrefixes = getArtifactSubpathPrefixes(cwd, taskId, taskSlug)
	const files = await listTaskArtifactFiles(taskArtifactRoots(cwd, taskId, taskSlug), subpathPrefixes)
	const changed = files.filter((file) => !ledger.isCurrent(file.fileName, file.fingerprint))

	const synced: SyncResult[] = []
	for (const file of changed) {
		if (signal?.aborted) break
		if (await hasMatchingCloudContent(syncManager, file.fileName, file.path)) {
			ledger.record(file.fileName, file.fingerprint)
			continue
		}
		const alreadyTracked = syncManager
			.getCollection()
			?.toArray.some((artifact) => artifact.file_name === file.fileName)
		try {
			synced.push(
				await syncFileAtPath(
					file.path,
					alreadyTracked ? 'Edit' : 'Write',
					syncManager,
					sessionId,
					subpathPrefixes,
				),
			)
			ledger.record(file.fileName, file.fingerprint)
		} catch (error) {
			logger.warn(
				{ err: error, sessionId, filePath: file.path },
				'Failed to sync artifact created by shell command',
			)
		}
	}
	return synced
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-export hash for text content hashing
// ─────────────────────────────────────────────────────────────────────────────

export { getMimeType, hash as computeTextHash, isTextFile }
