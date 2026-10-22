import type { ConversationEvent } from '../types'

export interface ContextCompactionPayload {
	trigger: 'manual' | 'auto'
	preTokens?: number
	postTokens?: number
	durationMs?: number
}

const isFiniteCount = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0

/**
 * Payload of a `system` conversation event written at a context-compaction
 * boundary. Returns null for every other event, including malformed content,
 * so callers can use it as the dispatch predicate.
 */
export function parseContextCompaction(
	event: Pick<ConversationEvent, 'eventType' | 'content'>,
): ContextCompactionPayload | null {
	if (event.eventType !== 'system' || !event.content) return null
	try {
		const parsed: unknown = JSON.parse(event.content)
		if (typeof parsed !== 'object' || parsed === null) return null
		const record = parsed as Record<string, unknown>
		if (record.kind !== 'context_compaction') return null
		const payload: ContextCompactionPayload = {
			trigger: record.trigger === 'auto' ? 'auto' : 'manual',
		}
		if (isFiniteCount(record.preTokens)) payload.preTokens = record.preTokens
		if (isFiniteCount(record.postTokens)) payload.postTokens = record.postTokens
		if (isFiniteCount(record.durationMs)) payload.durationMs = record.durationMs
		return payload
	} catch {
		return null
	}
}


export function contextCompactionTokensLabel(payload: ContextCompactionPayload): string {
	if (payload.preTokens === undefined || payload.postTokens === undefined) return ''
	return `${payload.preTokens.toLocaleString()} → ${payload.postTokens.toLocaleString()}`
}

export interface ContextCompactionSummary {
	/** Id of the `context_compaction` event this summary belongs to. */
	boundaryEventId: string
	summary: string
}

/**
 * Payload of the `system` conversation event that carries the summary written
 * at a context-compaction boundary. Null for every other event.
 */
export function parseContextCompactionSummary(
	event: Pick<ConversationEvent, 'eventType' | 'content'>,
): ContextCompactionSummary | null {
	if (event.eventType !== 'system' || !event.content) return null
	try {
		const parsed: unknown = JSON.parse(event.content)
		if (typeof parsed !== 'object' || parsed === null) return null
		const record = parsed as Record<string, unknown>
		if (record.kind !== 'context_compaction_summary') return null
		if (typeof record.boundaryEventId !== 'string' || record.boundaryEventId.length === 0) return null
		if (typeof record.summary !== 'string' || record.summary.length === 0) return null
		return { boundaryEventId: record.boundaryEventId, summary: record.summary }
	} catch {
		return null
	}
}
