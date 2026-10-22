import { toMs } from '@/minimalist/lib/format'
import { isSyntheticSkillPromptMessage } from '@/utils/sidebar-transforms'

/** The subset of a `conversation_events` row the transcript reads. */
export type EventRow = {
	id: string
	event_type: 'message' | 'tool_call' | 'tool_result' | 'thinking' | 'system'
	role: 'user' | 'assistant' | 'system'
	content: string | null
	tool_call_id: string | null
	tool_name: string | null
	tool_input_json: unknown
	parent_tool_use_id: string | null
	tool_result_for_id: string | null
	tool_result_content: string | null
	approval_status: 'pending' | 'approved' | 'denied' | null
	approval_id: string | null
	user_name: string | null
	user_id?: string | null
	created_at: bigint | number | string
}

export type ToolStep = {
	kind: 'tool'
	id: string
	toolCallId: string
	name: string
	input: Record<string, unknown>
	result: string | null
	isError: boolean
	approvalStatus: EventRow['approval_status']
	approvalId: string | null
	startedAt: number
	endedAt: number | null
	/** Events a subagent produced under this Task/Agent call. */
	children: Step[]
}

export type Step =
	| ToolStep
	| { kind: 'thinking'; id: string; text: string }
	| { kind: 'commentary'; id: string; text: string }
	/** A skill's instructions the agent loaded with no Skill call to hang them on, as after a typed `/skill`. */
	| { kind: 'skill'; id: string; name: string | null; text: string }

export type Turn =
	| { kind: 'user'; id: string; text: string; author: string | null; userId?: string | null; at: number }
	| {
			kind: 'agent'
			id: string
			steps: Step[]
			/** The last assistant message after the last tool call: what the user reads first. */
			answer: string | null
			startedAt: number
			endedAt: number
	  }
	| { kind: 'compaction'; id: string; at: number }

export function parseInput(value: unknown): Record<string, unknown> {
	if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
	if (typeof value === 'string') {
		try {
			const parsed: unknown = JSON.parse(value)
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
		} catch {
			return {}
		}
	}
	return {}
}

function isCompaction(row: EventRow): boolean {
	if (row.event_type !== 'system' || !row.content) return false
	try {
		const parsed: unknown = JSON.parse(row.content)
		return (
			typeof parsed === 'object' &&
			parsed !== null &&
			(parsed as { kind?: unknown }).kind === 'context_compaction'
		)
	} catch {
		return false
	}
}

/**
 * A call you denied, read from its result as the daemon words it: "Request denied by user",
 * or "The user denied this tool call with feedback: …" with what you typed.
 */
export function readDenial(result: string | null): { feedback: string | null } | null {
	const text = result?.trim() ?? ''
	if (text === 'Request denied by user') return { feedback: null }
	const match = text.match(/^The user denied this tool call with feedback: ([\s\S]*)$/)
	return match ? { feedback: match[1]?.trim() || null } : null
}

function looksLikeError(result: string | null): boolean {
	if (!result) return false
	return /^(Error|error:)|<tool_use_error>|exit code [1-9]|Exit code [1-9]/.test(result.slice(0, 400))
}

/**
 * The skill a loaded skill prompt belongs to. Claude Code opens it with the skill's directory
 * ("Base directory for this skill: …/rpi/create-plan"); CodeLayer with `<skill name="…">`.
 */
export function skillPromptName(text: string): string | null {
	const tagged = text.match(/^\s*<skill\s+name="([^"]+)"/)?.[1]
	if (tagged) return tagged
	const directory = text.match(/^Base directory for this skill:\s*(\S+)/)?.[1]?.replace(/\/+$/, '')
	return directory ? (directory.split('/').at(-1) ?? null) : null
}

/**
 * Fold a session's events into turns. A user message opens a turn; everything the agent does
 * until the next user message is one agent turn whose final assistant message is its answer.
 */
export function buildTurns(rows: readonly EventRow[]): Turn[] {
	const sorted = [...rows].sort((a, b) => toMs(a.created_at) - toMs(b.created_at))
	const results = new Map<string, EventRow>()
	const childrenByParent = new Map<string, EventRow[]>()
	for (const row of sorted) {
		if (row.event_type === 'tool_result' && row.tool_result_for_id) results.set(row.tool_result_for_id, row)
		if (row.parent_tool_use_id && row.event_type !== 'tool_result') {
			const list = childrenByParent.get(row.parent_tool_use_id) ?? []
			list.push(row)
			childrenByParent.set(row.parent_tool_use_id, list)
		}
	}

	const toStep = (row: EventRow): Step | null => {
		if (row.event_type === 'thinking') {
			return row.content?.trim() ? { kind: 'thinking', id: row.id, text: row.content } : null
		}
		if (row.event_type === 'message' && row.role === 'assistant') {
			return row.content?.trim() ? { kind: 'commentary', id: row.id, text: row.content } : null
		}
		if (row.event_type === 'tool_call' && row.tool_call_id) {
			const result = results.get(row.tool_call_id) ?? null
			const resultText = result?.tool_result_content ?? result?.content ?? null
			const children = (childrenByParent.get(row.tool_call_id) ?? []).map(toStep).filter((step) => step !== null)
			// The call row isn't marked when you deny it; the result says so.
			const denied = row.approval_status === 'denied' || readDenial(resultText) !== null
			return {
				kind: 'tool',
				id: row.id,
				toolCallId: row.tool_call_id,
				name: row.tool_name ?? 'tool',
				input: parseInput(row.tool_input_json),
				result: resultText,
				isError: denied || looksLikeError(resultText),
				approvalStatus: denied ? 'denied' : row.approval_status,
				approvalId: row.approval_id,
				startedAt: toMs(row.created_at),
				endedAt: result ? toMs(result.created_at) : null,
				children,
			}
		}
		return null
	}

	const turns: Turn[] = []
	let current: Extract<Turn, { kind: 'agent' }> | null = null
	const closeAgentTurn = () => {
		if (!current) return
		const last = current.steps.at(-1)
		// The answer is the trailing commentary, shown outside the collapsed work line.
		if (last?.kind === 'commentary') {
			current.answer = last.text
			current.steps = current.steps.slice(0, -1)
		}
		turns.push(current)
		current = null
	}

	for (const row of sorted) {
		if (row.parent_tool_use_id || row.event_type === 'tool_result') continue
		if (isCompaction(row)) {
			closeAgentTurn()
			turns.push({ kind: 'compaction', id: row.id, at: toMs(row.created_at) })
			continue
		}
		if (row.event_type === 'system') continue
		// A skill's instructions arrive as a user message nobody typed. They belong to the agent's
		// work: as the result of the Skill call that loaded them, or as a step of their own.
		if (row.event_type === 'message' && row.role === 'user' && isSyntheticSkillPromptMessage(row.content)) {
			const text = row.content ?? ''
			const at = toMs(row.created_at)
			const last: Step | undefined = current?.steps.at(-1)
			if (last?.kind === 'tool' && normalizeToolName(last.name) === 'skill') {
				last.result = text
				continue
			}
			if (!current) current = { kind: 'agent', id: row.id, steps: [], answer: null, startedAt: at, endedAt: at }
			current.steps.push({ kind: 'skill', id: row.id, name: skillPromptName(text), text })
			current.endedAt = Math.max(current.endedAt, at)
			continue
		}
		if (row.event_type === 'message' && row.role === 'user') {
			closeAgentTurn()
			if (row.content?.trim()) {
				turns.push({
					kind: 'user',
					id: row.id,
					text: row.content,
					author: row.user_name,
					userId: row.user_id,
					at: toMs(row.created_at),
				})
			}
			continue
		}
		const step = toStep(row)
		if (!step) continue
		const at = toMs(row.created_at)
		if (!current) current = { kind: 'agent', id: row.id, steps: [], answer: null, startedAt: at, endedAt: at }
		current.steps.push(step)
		current.endedAt = Math.max(current.endedAt, step.kind === 'tool' ? (step.endedAt ?? at) : at)
	}
	closeAgentTurn()
	return turns
}

/** Groups consecutive read-only exploration steps so "Read 4 files" shows as one line. */
export type StepGroup = { kind: 'explore'; id: string; steps: ToolStep[] } | { kind: 'single'; step: Step }

const EXPLORE_TOOLS = new Set(['read', 'grep', 'glob', 'ls', 'notebookread'])

function isExploreStep(step: Step): step is ToolStep {
	return step.kind === 'tool' && EXPLORE_TOOLS.has(normalizeToolName(step.name))
}

export function groupSteps(steps: readonly Step[]): StepGroup[] {
	const groups: StepGroup[] = []
	for (const step of steps) {
		const last = groups.at(-1)
		if (isExploreStep(step)) {
			if (last?.kind === 'explore') last.steps.push(step)
			else groups.push({ kind: 'explore', id: step.id, steps: [step] })
			continue
		}
		groups.push({ kind: 'single', step })
	}
	// A lone read reads better as its own line than as "Explored 1 file".
	return groups.map((group) =>
		group.kind === 'explore' && group.steps.length === 1 && group.steps[0]
			? { kind: 'single', step: group.steps[0] }
			: group,
	)
}

export function normalizeToolName(name: string): string {
	return name.toLowerCase().replace(/_/g, '')
}
