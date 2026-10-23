import type { NextStepSuggestion } from '@humanlayer/db/zodschemas/next-step'

import {
	isAgentToolName as sharedIsAgentToolName,
	normalizeSkillToolInput as sharedNormalizeSkillToolInput,
	normalizeToolName as sharedNormalizeToolName,
	type NormalizedSkillToolInput,
} from '../../lib/tool-names'

// Core event types (simplified from HLD SDK for pure component use)
export type ConversationEventType = 'message' | 'tool_call' | 'tool_result' | 'system' | 'thinking'
export type ConversationRole = 'user' | 'assistant' | 'system'
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'resolved'

export interface ConversationSender {
	displayName: string
	initials: string
	profilePictureUrl?: string
}

export interface ConversationEvent {
	id: string
	sessionId: string
	eventType: ConversationEventType
	createdAt: Date
	role?: ConversationRole
	content?: string
	toolId?: string
	toolName?: string
	toolInputJson?: string
	parentToolUseId?: string
	toolResultForId?: string
	toolResultContent?: string
	isCompleted?: boolean
	approvalStatus?: ApprovalStatus
	approvalId?: string
	nextStepSuggestion?: NextStepSuggestion | null
	sender?: ConversationSender
	/** Raw suggestions from approvals.suggestions jsonb (parsed at render site) */
	suggestions?: unknown
}

// Tool name enum for type-safe matching
export enum ToolName {
	Bash = 'Bash',
	BashOutput = 'BashOutput',
	Task = 'Task',
	Agent = 'Agent',
	TodoWrite = 'TodoWrite',
	Read = 'Read',
	Write = 'Write',
	Edit = 'Edit',
	MultiEdit = 'MultiEdit',
	NotebookRead = 'NotebookRead',
	NotebookEdit = 'NotebookEdit',
	ExitPlanMode = 'ExitPlanMode',
	Grep = 'Grep',
	Glob = 'Glob',
	LS = 'LS',
	WebSearch = 'WebSearch',
	WebFetch = 'WebFetch',
	Skill = 'Skill',
	ApplyPatch = 'apply_patch',
}

export type AgentToolName = 'Task' | 'Agent' | 'subagent'

export { sharedNormalizeToolName as normalizeToolName }
export { sharedNormalizeSkillToolInput as normalizeSkillToolInput }
export type SkillToolInput = NormalizedSkillToolInput

export function isAgentToolName(name: string | undefined | null): boolean {
	return sharedIsAgentToolName(name)
}

// Generic tool call content props interface
export interface ToolCallContentProps<T = Record<string, unknown>> {
	toolInput: T
	approvalStatus?: ApprovalStatus
	isCompleted?: boolean
	toolResultContent?: string
	isFocused?: boolean
	isGroupItem?: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeEdit = (edit: unknown): unknown => {
	if (!isRecord(edit)) return edit
	const normalized = { ...edit }
	if (typeof edit.oldText === 'string') normalized.old_string = edit.oldText
	if (typeof edit.newText === 'string') normalized.new_string = edit.newText
	return normalized
}

const normalizeToolInputAliases = (input: unknown): unknown => {
	if (!isRecord(input)) return input
	const normalized = { ...input }
	if (typeof input.path === 'string') normalized.file_path = input.path
	if (typeof input.timeout_ms === 'number') normalized.timeout = input.timeout_ms
	if (Array.isArray(input.edits)) {
		normalized.edits = input.edits.map(normalizeEdit)
		if (input.edits.length === 1) {
			const edit = normalizeEdit(input.edits[0])
			if (isRecord(edit)) {
				if (typeof edit.old_string === 'string') normalized.old_string = edit.old_string
				if (typeof edit.new_string === 'string') normalized.new_string = edit.new_string
			}
		}
	}
	return normalized
}

// Parse tool input safely and normalize aliases emitted by supported agent runtimes.
export function parseToolInput<T>(toolInputJson: string | undefined): T | null {
	if (!toolInputJson) return null
	try {
		return normalizeToolInputAliases(JSON.parse(toolInputJson)) as T
	} catch {
		return null
	}
}

// Tool-specific input types
export interface BashToolInput {
	command: string
	description?: string
	timeout?: number
	run_in_background?: boolean
}

export interface ReadToolInput {
	file_path: string
	offset?: number
	limit?: number
}

export interface WriteToolInput {
	file_path: string
	content: string
}

export interface EditToolInput {
	file_path: string
	old_string: string
	new_string: string
	replace_all?: boolean
	edits?: Array<{
		old_string: string
		new_string: string
		replace_all?: boolean
	}>
}

export interface GrepToolInput {
	pattern: string
	path?: string
	output_mode?: 'content' | 'files_with_matches' | 'count'
	glob?: string
	type?: string
	head_limit?: number
}

export interface GlobToolInput {
	pattern: string
	path?: string
}

export interface LSToolInput {
	path: string
	recursive?: boolean
}

export interface TaskToolInput {
	description: string
	prompt: string
	subagent_type: string
}

export interface TodoItem {
	content: string
	status: 'pending' | 'in_progress' | 'completed'
	activeForm: string
}

export interface TodoWriteToolInput {
	todos: TodoItem[]
}

export interface WebSearchToolInput {
	query: string
	allowed_domains?: string[]
	blocked_domains?: string[]
}

export interface WebFetchToolInput {
	url: string
	prompt?: string
}

export interface MultiEditToolInput {
	file_path: string
	edits: Array<{
		old_string: string
		new_string: string
		replace_all?: boolean
	}>
}

export interface NotebookReadToolInput {
	notebook_path: string
}

export interface NotebookEditToolInput {
	notebook_path: string
	cell_number?: number
	new_source: string
	cell_type?: 'code' | 'markdown'
	edit_mode?: 'replace' | 'insert' | 'delete'
}

export interface ExitPlanModeToolInput {
	plan: string
}

export interface ApplyPatchToolInput {
	patch_text: string
}

// Agent group interface for collapsible agent groups
export interface AgentEventGroup {
	parentAgent: ConversationEvent
	subAgentEvents: ConversationEvent[]
	toolCallCount: number
	latestEvent: ConversationEvent | null
	hasPendingApproval: boolean
	finalResponse?: string // Assistant's final response from task completion
}
