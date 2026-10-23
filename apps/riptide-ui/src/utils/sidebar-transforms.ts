import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import type { Todo } from '@humanlayer/ui/components/todo-widget'
import type { MinimapEvent } from '@humanlayer/ui/components/vertical-minimap'
import {
	isApplyPatchTool,
	isFileOperationTool,
	normalizeToolName,
	toCanonicalOperation,
} from '@humanlayer/ui/lib/tool-names'

import {
	type ArtifactCategory,
	type ArtifactOperation,
	categorizeArtifact,
	extractArtifactPath,
} from './artifact-categorization'
import { getArtifactDocumentType } from './artifact-document-type'

/**
 * Detect messages that contain only a local-command-stdout tag
 * (e.g. "<local-command-stdout>Set model to ...</local-command-stdout>").
 * These are injected by the Claude process and should not appear in the minimap
 * or fork selector.
 */
export function isLocalCommandMessage(content: string | null | undefined): boolean {
	if (!content) return false
	return /^\s*<local-command-stdout>/.test(content)
}

const CLAUDE_CODE_SYNTHETIC_SKILL_PROMPT_PREFIX = 'Base directory for this skill:'
const CODELAYER_SYNTHETIC_SKILL_PROMPT_PATTERN = /^\s*<skill\s+name=/
const REQUEST_INTERRUPTED_BY_USER_MARKER = 'request interrupted by user'

export function isSyntheticSkillPromptMessage(content: string | null | undefined): boolean {
	if (!content) return false
	return (
		content.startsWith(CLAUDE_CODE_SYNTHETIC_SKILL_PROMPT_PREFIX) ||
		CODELAYER_SYNTHETIC_SKILL_PROMPT_PATTERN.test(content)
	)
}

export function isRequestInterruptedByUserMessage(content: string | null | undefined): boolean {
	if (!content) return false
	return content.toLowerCase().includes(REQUEST_INTERRUPTED_BY_USER_MARKER)
}

export function isForkExcludedMessage(content: string | null | undefined): boolean {
	return (
		isLocalCommandMessage(content) ||
		isSyntheticSkillPromptMessage(content) ||
		isRequestInterruptedByUserMessage(content)
	)
}

export function mapSyntheticSkillPromptsToToolResults(
	events: ConversationEvent[],
	toolResultsByKey: Record<string, ConversationEvent>,
): Record<string, ConversationEvent> {
	const mappedToolResults = { ...toolResultsByKey }
	let pendingSkillToolCall: ConversationEvent | null = null

	for (const event of events) {
		if (event.eventType === 'tool_call' && normalizeToolName(event.toolName) === 'skill' && event.toolId) {
			pendingSkillToolCall = event
			continue
		}

		if (
			event.eventType === 'tool_result' &&
			pendingSkillToolCall?.toolId &&
			event.toolResultForId === pendingSkillToolCall.toolId
		) {
			continue
		}

		if (
			event.eventType === 'message' &&
			event.role === 'user' &&
			isSyntheticSkillPromptMessage(event.content) &&
			pendingSkillToolCall?.toolId
		) {
			mappedToolResults[pendingSkillToolCall.toolId] = {
				...event,
				eventType: 'tool_result',
				toolResultForId: pendingSkillToolCall.toolId,
				toolResultContent: event.content,
			}
			pendingSkillToolCall = null
			continue
		}

		pendingSkillToolCall = null
	}

	return mappedToolResults
}

/**
 * Transform ConversationEvents to MinimapEvents for the VerticalMinimap
 */
export function eventsToMinimapEvents(events: ConversationEvent[]): MinimapEvent[] {
	return events
		.filter(
			(e) =>
				e.eventType !== 'tool_result' &&
				e.eventType !== 'thinking' &&
				!isLocalCommandMessage(e.content) &&
				!isSyntheticSkillPromptMessage(e.content),
		)
		.map(
			(e) =>
				({
					id: e.id,
					eventType: e.eventType,
					toolName: e.toolName,
					toolId: e.toolId,
					role: e.role,
					approvalStatus: e.approvalStatus,
					parentToolUseId: e.parentToolUseId,
					toolInputJson: e.toolInputJson,
					content: e.content,
					isCompleted: e.isCompleted,
				}) as MinimapEvent,
		)
}

/**
 * Extract todos from the latest TodoWrite tool call event
 */
export function extractTodosFromEvents(events: ConversationEvent[]): Todo[] {
	// Find the last TodoWrite event
	const todoEvents = events.filter(
		(e) => e.eventType === 'tool_call' && normalizeToolName(e.toolName) === 'todowrite',
	)

	if (todoEvents.length === 0) return []

	const lastTodoEvent = todoEvents[todoEvents.length - 1]
	if (lastTodoEvent === undefined) return []

	try {
		const input = JSON.parse(lastTodoEvent.toolInputJson || '{}')
		if (Array.isArray(input.todos)) {
			return input.todos.map((todo: { content: string; status: string; activeForm?: string }) => ({
				content: todo.content,
				status: todo.status as 'pending' | 'in_progress' | 'completed',
				activeForm: todo.activeForm,
			}))
		}
	} catch {
		// Invalid JSON, return empty
	}

	return []
}

export interface SessionArtifact {
	path: string
	categories: ArtifactCategory[]
	id?: string // artifact ID from database, if available
	resourceOwnerUserId?: string | null
	shareKey?: string | null
	shareEnabled?: boolean | null
	storageType?: string | null
	/** Document type from the artifact's YAML frontmatter `type` field (research, plan, …) */
	frontmatterType?: string | null
}

// Re-export types for convenience
export type { ArtifactCategory, ArtifactOperation } from './artifact-categorization'

/**
 * Normalize unicode whitespace characters (e.g. narrow no-break space U+202F
 * that macOS uses in timestamp-formatted filenames) to regular ASCII spaces
 * so that filename lookups match regardless of which space variant is used.
 */
function normalizeSpaces(s: string): string {
	return s.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
}

function parseToolInput(toolInputJson: string | undefined): unknown {
	const raw = toolInputJson || '{}'
	let input = JSON.parse(raw)
	if (typeof input === 'string') {
		input = JSON.parse(input)
	}
	return input
}

function pushOperation(
	operationsByKey: Map<string, ArtifactOperation[]>,
	key: string,
	operation: ArtifactOperation,
): void {
	const ops = operationsByKey.get(key) || []
	ops.push(operation)
	operationsByKey.set(key, ops)
}

interface ApplyPatchArtifactOperation {
	filePath: string
	operation: ArtifactOperation
}

type ApplyPatchAction = 'Add' | 'Update' | 'Delete' | 'Move'

function operationForApplyPatchAction(action: ApplyPatchAction): ArtifactOperation {
	return action === 'Add' ? 'Write' : 'Edit'
}

function dedupeApplyPatchOperations(operations: ApplyPatchArtifactOperation[]): ApplyPatchArtifactOperation[] {
	const deduped: ApplyPatchArtifactOperation[] = []
	const seen = new Set<string>()

	for (const operation of operations) {
		if (seen.has(operation.filePath)) continue
		seen.add(operation.filePath)
		deduped.push(operation)
	}

	return deduped
}

function extractApplyPatchArtifactOperations(toolInput: unknown): ApplyPatchArtifactOperation[] {
	if (!toolInput || typeof toolInput !== 'object') return []

	const input = toolInput as Record<string, unknown>
	const patchText = input.patch_text ?? input.patchText
	if (typeof patchText !== 'string') return []

	const operations: ApplyPatchArtifactOperation[] = []
	let lastOperationIndex = -1
	for (const line of patchText.split('\n')) {
		const actionMatch = line.match(/^\*\*\*\s+(Add|Update|Delete)\s+File:\s*(.+)$/)
		if (actionMatch?.[1] && actionMatch[2]) {
			const action = actionMatch[1] as ApplyPatchAction
			operations.push({
				filePath: actionMatch[2].trim(),
				operation: operationForApplyPatchAction(action),
			})
			lastOperationIndex = operations.length - 1
			continue
		}

		const moveMatch = line.match(/^\*\*\*\s+Move to:\s*(.+)$/)
		if (!moveMatch?.[1]) continue

		const moveOperation: ApplyPatchArtifactOperation = {
			filePath: moveMatch[1].trim(),
			operation: operationForApplyPatchAction('Move'),
		}

		if (lastOperationIndex >= 0) {
			operations[lastOperationIndex] = moveOperation
		} else {
			operations.push(moveOperation)
			lastOperationIndex = operations.length - 1
		}
	}

	return dedupeApplyPatchOperations(operations)
}

function collectArtifactOperationsByKey(
	events: ConversationEvent[],
	keyForArtifactPath: (artifactPath: string) => string,
): Map<string, ArtifactOperation[]> {
	const operationsByKey = new Map<string, ArtifactOperation[]>()

	const toolCallEvents = events.filter(
		(event) =>
			event.eventType === 'tool_call' &&
			(isFileOperationTool(event.toolName) || isApplyPatchTool(event.toolName)),
	)

	for (const event of toolCallEvents) {
		try {
			const input = parseToolInput(event.toolInputJson) as {
				file_path?: string
				edits?: Array<{ file_path?: string }>
			}

			if (isApplyPatchTool(event.toolName)) {
				const seenPatchKeys = new Set<string>()
				for (const patchOperation of extractApplyPatchArtifactOperations(input)) {
					const artifactPath = extractArtifactPath(patchOperation.filePath)
					if (!artifactPath) continue
					const key = keyForArtifactPath(artifactPath)
					if (seenPatchKeys.has(key)) continue
					seenPatchKeys.add(key)
					pushOperation(operationsByKey, key, patchOperation.operation)
				}
				continue
			}

			const operation = toCanonicalOperation(event.toolName)
			if (!operation) continue

			if (operation === 'MultiEdit') {
				if (input.file_path) {
					const artifactPath = extractArtifactPath(input.file_path)
					if (artifactPath) {
						pushOperation(operationsByKey, keyForArtifactPath(artifactPath), operation)
					}
				}

				if (Array.isArray(input.edits)) {
					for (const edit of input.edits) {
						if (!edit.file_path) continue
						const artifactPath = extractArtifactPath(edit.file_path)
						if (!artifactPath) continue
						pushOperation(operationsByKey, keyForArtifactPath(artifactPath), operation)
					}
				}
				continue
			}

			if (!input.file_path) continue
			const artifactPath = extractArtifactPath(input.file_path)
			if (!artifactPath) continue

			pushOperation(operationsByKey, keyForArtifactPath(artifactPath), operation)
		} catch {
			// Invalid JSON, skip event
		}
	}

	return operationsByKey
}

/**
 * Extract operations by filename from conversation events.
 * Returns a Map of filename -> operations for classification purposes.
 * This is used to classify database artifacts based on session events.
 */
export function extractOperationsByFilename(events: ConversationEvent[]): Map<string, ArtifactOperation[]> {
	return collectArtifactOperationsByKey(events, (artifactPath) =>
		normalizeSpaces(artifactPath.split('/').pop() || artifactPath),
	)
}

/**
 * Extract artifacts from conversation events.
 * Tracks Read/Edit/Write/MultiEdit operations on files in .humanlayer/tasks/ and thoughts/ directories.
 * @deprecated Use extractOperationsByFilename + classifyDbArtifacts instead for database-first approach
 */
export function extractArtifactsFromEvents(events: ConversationEvent[]): SessionArtifact[] {
	const operationsByPath = collectArtifactOperationsByKey(events, (artifactPath) => artifactPath)

	const artifacts: SessionArtifact[] = []
	for (const [path, operations] of operationsByPath) {
		const categories = categorizeArtifact(operations)
		if (categories.length > 0) {
			artifacts.push({ path, categories })
		}
	}

	return artifacts
}

/**
 * Database artifact shape from useLiveQuery
 */
export interface DbArtifact {
	id: string
	file_name: string
	task_slug: string | null
	resource_owner_user_id?: string | null
	share_key?: string | null
	share_enabled?: boolean | null
	storage_type?: string | null
	frontmatter?: unknown
}

/**
 * Classify database artifacts using conversation events.
 * Uses dbArtifacts as the source of truth for which artifacts exist,
 * and conversation events to determine classification (source/edited/new).
 */
export function classifyDbArtifacts(
	dbArtifacts: DbArtifact[],
	operationsByFilename: Map<string, string[]>,
): SessionArtifact[] {
	return dbArtifacts.map((artifact) => {
		const operations = operationsByFilename.get(normalizeSpaces(artifact.file_name)) || []

		let categories = categorizeArtifact(operations)

		// Artifacts with no conversation events (not Read/Written/Edited in this session)
		// are categorized as 'unreferenced' so they still appear in the sidebar.
		if (categories.length === 0) {
			categories = ['unreferenced']
		}

		// Build path from task_slug and file_name
		const path = artifact.task_slug
			? `.humanlayer/tasks/${artifact.task_slug}/${artifact.file_name}`
			: artifact.file_name

		return {
			id: artifact.id,
			path,
			categories,
			resourceOwnerUserId: artifact.resource_owner_user_id,
			shareKey: artifact.share_key,
			shareEnabled: artifact.share_enabled,
			storageType: artifact.storage_type,
			frontmatterType: getArtifactDocumentType(artifact.frontmatter),
		}
	})
}
