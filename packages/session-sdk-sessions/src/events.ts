// Conversation events as a host sends them to sessions/events/create: the shapes the web app
// knows, ids that stay the same when a host sends an event again, and the size limits.

import { createHash } from 'node:crypto'

import { cutUtf8, type DaemonRequest } from '@humanlayer/session-sdk-base'

/** A sessions/events/create body without sessionId, which the sender adds. */
export type SessionEvent = Omit<DaemonRequest<'sessions/events/create'>, 'sessionId'>

/** The fields that say what an event is, without its ids. */
export type EventFields = Omit<SessionEvent, 'eventId' | 'codingAgentSessionId' | 'codingAgentEventId'>

export const EVENT_LIMITS = {
	/** content, toolResultContent, and each string in toolInputJson. */
	contentBytes: 1024 * 1024,
	/** A hidden event's JSON. */
	hiddenBytes: 256 * 1024,
	/** toolCallId and toolResultForId; the API cuts longer ids to this too. */
	idChars: 256,
} as const

/** A system event the web app shows, holding a JSON payload such as {kind: 'context_compaction'}. */
export function systemFields(payload: Record<string, unknown>): EventFields {
	return { eventType: 'system', role: 'system', content: JSON.stringify(payload) }
}

/** A system event the web app hides. It keeps the cloud copy of the session complete. */
export function hiddenFields(payload: Record<string, unknown>): EventFields {
	return { eventType: 'system', role: 'system', content: cutUtf8(JSON.stringify(payload), EVENT_LIMITS.hiddenBytes) }
}

/** The event cut to EVENT_LIMITS. toolInputJson becomes a deep copy, never the caller's object. */
export function fitEvent<E extends SessionEvent>(event: E): E {
	const fitted = { ...event }
	fitted.content &&= cutUtf8(fitted.content, EVENT_LIMITS.contentBytes)
	fitted.toolResultContent &&= cutUtf8(fitted.toolResultContent, EVENT_LIMITS.contentBytes)
	fitted.toolCallId &&= fitted.toolCallId.slice(0, EVENT_LIMITS.idChars)
	fitted.toolResultForId &&= fitted.toolResultForId.slice(0, EVENT_LIMITS.idChars)
	if (fitted.toolInputJson !== undefined) fitted.toolInputJson = cutStrings(fitted.toolInputJson)
	return fitted
}

function cutStrings(value: unknown): unknown {
	if (typeof value === 'string') return cutUtf8(value, EVENT_LIMITS.contentBytes)
	if (Array.isArray(value)) return value.map(cutStrings)
	if (typeof value !== 'object' || value === null) return value
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cutStrings(item)]))
}

// Fixed namespace for eventUuid below. Arbitrary but constant, so a name always maps to the same id.
const NAME_UUID_NAMESPACE = Buffer.from('c7b1b7b063e4de4a9c8a2f6b7a4e9d31', 'hex')

/**
 * A UUIDv5-shaped id from a name (sha1, not for security), such as `${agentSessionId}:${entryId}:0`.
 * The same event sent twice gets the same eventId, so the API keeps one copy.
 */
export function eventUuid(name: string): string {
	const hash = createHash('sha1')
		.update(Buffer.concat([NAME_UUID_NAMESPACE, Buffer.from(name, 'utf8')]))
		.digest()
	const bytes = hash.subarray(0, 16)
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50 // version 5
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80 // variant RFC 4122
	const hex = Buffer.from(bytes).toString('hex')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
