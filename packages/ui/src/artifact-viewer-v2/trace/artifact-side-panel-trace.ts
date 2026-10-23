export const ARTIFACT_TRACE_BEFORE_MARK_MS = 30_000
export const ARTIFACT_TRACE_AFTER_MARK_MS = 5_000
export const ARTIFACT_TRACE_EVENT_CAP = 2_000

export type ArtifactTraceValue = string | number | boolean | null

export interface ArtifactTraceEvent {
	at: number
	type: string
	data: Record<string, ArtifactTraceValue>
}

export interface ArtifactTracePort {
	record: (type: string, data?: Record<string, unknown>) => void
}

export interface ArtifactTraceExport {
	version: 1
	markedAt: number | null
	exportedAt: number
	events: ArtifactTraceEvent[]
}

export interface ArtifactTraceStatus {
	eventCount: number
	markedAt: number | null
	captureEndsAt: number | null
	isCapturing: boolean
}

const SENSITIVE_KEY = /(content|text|title|name|email|useragent)|id$/i
const NEEDED_ID_KEY = /^(instanceId|nodeId|layoutId)$/

function safeValue(key: string, value: unknown): ArtifactTraceValue | undefined {
	if (SENSITIVE_KEY.test(key) && !NEEDED_ID_KEY.test(key)) return '[redacted]'
	if (value == null) return null
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return typeof value === 'string' && value.length > 120 ? `${value.slice(0, 120)}...` : value
	}
	return undefined
}

export function redactArtifactTraceData(data: Record<string, unknown>): Record<string, ArtifactTraceValue> {
	const safe: Record<string, ArtifactTraceValue> = {}
	for (const [key, value] of Object.entries(data)) {
		const next = safeValue(key, value)
		if (next !== undefined) safe[key] = next
	}
	return safe
}

export function createArtifactSidePanelTraceSession(options?: {
	now?: () => number
	eventCap?: number
	setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
	clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}) {
	const now = options?.now ?? (() => Date.now())
	const eventCap = options?.eventCap ?? ARTIFACT_TRACE_EVENT_CAP
	const setTimer = options?.setTimer ?? ((callback, delay) => setTimeout(callback, delay))
	const clearTimer = options?.clearTimer ?? ((timer) => clearTimeout(timer))
	let events: ArtifactTraceEvent[] = []
	let markedAt: number | null = null
	let captureTimer: ReturnType<typeof setTimeout> | null = null
	const listeners = new Set<() => void>()
	let currentStatus: ArtifactTraceStatus = { eventCount: 0, markedAt: null, captureEndsAt: null, isCapturing: false }
	const emit = () => {
		for (const listener of listeners) listener()
	}
	const refreshStatus = () => {
		const captureEndsAt = markedAt == null ? null : markedAt + ARTIFACT_TRACE_AFTER_MARK_MS
		currentStatus = {
			eventCount: events.length,
			markedAt,
			captureEndsAt,
			isCapturing: captureEndsAt != null && now() < captureEndsAt,
		}
	}
	const status = () => currentStatus

	const prune = (at: number) => {
		const windowEnd = markedAt ?? at
		events = events.filter((event) => event.at >= windowEnd - ARTIFACT_TRACE_BEFORE_MARK_MS)
		if (events.length > eventCap) events = events.slice(-eventCap)
	}
	const record = (type: string, data: Record<string, unknown> = {}) => {
		const at = now()
		if (markedAt != null && at > markedAt + ARTIFACT_TRACE_AFTER_MARK_MS) return
		events.push({ at, type, data: redactArtifactTraceData(data) })
		prune(at)
		refreshStatus()
		emit()
	}

	return {
		record,
		mark(label = 'saw-flicker') {
			markedAt = now()
			record('mark', { label })
			if (captureTimer != null) clearTimer(captureTimer)
			captureTimer = setTimer(() => {
				captureTimer = null
				refreshStatus()
				emit()
			}, ARTIFACT_TRACE_AFTER_MARK_MS)
		},
		clear() {
			if (captureTimer != null) clearTimer(captureTimer)
			captureTimer = null
			events = []
			markedAt = null
			refreshStatus()
			emit()
		},
		status,
		subscribe(listener: () => void) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		exportTrace(): ArtifactTraceExport {
			const exportedAt = now()
			const start = (markedAt ?? exportedAt) - ARTIFACT_TRACE_BEFORE_MARK_MS
			const end = markedAt == null ? exportedAt : markedAt + ARTIFACT_TRACE_AFTER_MARK_MS
			return { version: 1, markedAt, exportedAt, events: events.filter((event) => event.at >= start && event.at <= end) }
		},
	}
}
