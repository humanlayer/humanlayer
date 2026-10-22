export interface TranscriptEvent {
	event_type: string
	role: string | null
	content: string | null
	tool_name: string | null
	tool_input_json: unknown
	tool_result_content: string | null
}

export interface TranscriptOptions {
	includeToolCalls: boolean
	maxToolTextChars?: number
	maxTranscriptChars?: number
}

/** Per tool call input and per tool result; the head and tail are kept. */
export const MAX_TOOL_TEXT_CHARS = 4_000

/**
 * Whole transcript. Over budget, the opening block (the original request) and
 * the most recent blocks are kept, and the oldest blocks in between are dropped.
 */
export const MAX_TRANSCRIPT_CHARS = 200_000

const BLOCK_SEPARATOR = '\n\n'
const OPENING_BLOCK_SHARE = 0.25
const TRUNCATION_MARKER_ALLOWANCE = 48

function truncationMarker(omittedChars: number): string {
	return `\n[… ${omittedChars} characters omitted …]\n`
}

function omittedBlocksMarker(omittedBlocks: number): string {
	return `[… ${omittedBlocks} earlier entries omitted …]`
}

export function truncateMiddle(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text
	const keptChars = Math.max(0, maxChars - TRUNCATION_MARKER_ALLOWANCE)
	const headChars = Math.ceil(keptChars / 2)
	const tailChars = keptChars - headChars
	const tail = tailChars > 0 ? text.slice(-tailChars) : ''
	return `${text.slice(0, headChars)}${truncationMarker(text.length - keptChars)}${tail}`
}

function joinedLength(blocks: string[]): number {
	return (
		blocks.reduce((sum, block) => sum + block.length, 0) + BLOCK_SEPARATOR.length * Math.max(0, blocks.length - 1)
	)
}

function capTranscriptBlocks(blocks: string[], maxChars: number): string[] {
	const [first, ...rest] = blocks
	if (first === undefined || joinedLength(blocks) <= maxChars) return blocks

	const opening = truncateMiddle(first, Math.floor(maxChars * OPENING_BLOCK_SHARE))
	const markerReserve = BLOCK_SEPARATOR.length + omittedBlocksMarker(rest.length).length
	let budget = maxChars - opening.length - markerReserve

	const recent: string[] = []
	for (let index = rest.length - 1; index >= 0; index--) {
		const block = rest[index] ?? ''
		const cost = BLOCK_SEPARATOR.length + block.length
		if (cost > budget) break
		recent.unshift(block)
		budget -= cost
	}

	const latest = rest.at(-1)
	if (recent.length === 0 && latest !== undefined) {
		recent.push(truncateMiddle(latest, budget - BLOCK_SEPARATOR.length))
	}

	const omittedBlocks = rest.length - recent.length
	return omittedBlocks > 0 ? [opening, omittedBlocksMarker(omittedBlocks), ...recent] : [opening, ...recent]
}

function roleHeading(role: string | null): string {
	if (role === 'user') return 'User'
	if (role === 'system') return 'System'
	return 'Assistant'
}

function renderToolInput(toolInput: unknown): string {
	if (toolInput === null || toolInput === undefined) return ''
	if (typeof toolInput === 'string') return toolInput
	return JSON.stringify(toolInput, null, 2)
}

/**
 * Renders an ordered list of conversation events into a plain-text transcript
 * used as the initial prompt of a handed-off session. Tool calls and results
 * are included only when includeToolCalls is set. Tool text and the whole
 * transcript are capped by MAX_TOOL_TEXT_CHARS and MAX_TRANSCRIPT_CHARS.
 */
export function renderConversationTranscript(events: TranscriptEvent[], options: TranscriptOptions): string {
	const maxToolTextChars = options.maxToolTextChars ?? MAX_TOOL_TEXT_CHARS
	const maxTranscriptChars = options.maxTranscriptChars ?? MAX_TRANSCRIPT_CHARS
	const blocks: string[] = []

	for (const event of events) {
		if (event.event_type === 'message' || event.event_type === 'thinking') {
			const content = event.content?.trim()
			if (!content) continue
			const heading = roleHeading(event.role)
			const label = event.event_type === 'thinking' ? `${heading} (thinking)` : heading
			blocks.push(`## ${label}\n${content}`)
			continue
		}

		if (!options.includeToolCalls) continue

		if (event.event_type === 'tool_call') {
			const input = truncateMiddle(renderToolInput(event.tool_input_json).trim(), maxToolTextChars)
			const name = event.tool_name ?? 'tool'
			blocks.push(input ? `### Tool call: ${name}\n${input}` : `### Tool call: ${name}`)
			continue
		}

		if (event.event_type === 'tool_result') {
			const result = event.tool_result_content?.trim()
			if (!result) continue
			blocks.push(`### Tool result\n${truncateMiddle(result, maxToolTextChars)}`)
		}
	}

	return capTranscriptBlocks(blocks, maxTranscriptChars).join(BLOCK_SEPARATOR)
}
