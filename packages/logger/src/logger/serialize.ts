import { type JsonValue, type LogLevel, logLevels } from './types'

export type Serializer = {
	serialize: (o: unknown, logLevel: LogLevel) => JsonValue | Promise<JsonValue>

	shouldSerialize: (o: unknown) => boolean
}

export const ErrorSerializer: Serializer = {
	shouldSerialize: (e) => e instanceof Error,
	serialize: (e, _logLevel) => {
		// shouldSerialize already gated this to an Error; re-check to narrow for the type system.
		if (!(e instanceof Error)) return null
		return {
			name: e.name,
			message: e.message,
			stack: e.stack,
			cause: e.cause,
		} as JsonValue
	},
}

export const RequestSerializer: Serializer = {
	shouldSerialize: (o) => o instanceof Request,
	serialize: async (r, l) => {
		if (!(r instanceof Request)) return null
		const serialized: {
			method: string
			url: string
			headers?: Record<string, string>
			body?: string
		} = {
			method: r.method,
			url: r.url,
		}
		if (logLevels[l] <= logLevels.debug) {
			const headers: Record<string, string> = {}
			r.headers.forEach((v, k, _h) => {
				headers[k] = v
			})
			serialized.headers = headers
			serialized.body = await r.clone().text()
		}
		return serialized
	},
}

export const ResponseSerializer: Serializer = {
	shouldSerialize: (o) => o instanceof Response,
	serialize: async (r, l) => {
		if (!(r instanceof Response)) return null
		const serialized: {
			status: number
			statusText: string
			headers?: Record<string, string>
			body?: string
		} = {
			status: r.status,
			statusText: r.statusText,
		}
		if (logLevels[l] <= logLevels.debug) {
			const headers: Record<string, string> = {}
			r.headers.forEach((v, k, _h) => {
				headers[k] = v
			})
			serialized.headers = headers
			serialized.body = await r.clone().text()
		}
		return serialized
	},
}

export const AnySerializer: Serializer = {
	shouldSerialize: () => true,
	serialize: (o, _l) => JSON.parse(JSON.stringify(normalizeForJson(o))),
}

function normalizeForJson(value: unknown, seen = new WeakSet<object>()): unknown {
	if (!value || typeof value !== 'object') return value
	if (value instanceof Date) return value.toISOString()

	// The circular guard MUST run before the Error branch below. An error whose cause
	// chain points back to itself (or to an ancestor error) — errA.cause = errB;
	// errB.cause = errA, or a self-cause — otherwise recurses until the stack overflows,
	// because the previous ordering handled errors before ever consulting or populating
	// `seen`. That overflow is caught upstream (serializeObject), so it never crashes or
	// loops, but the catch fires only AFTER a full stack unwind: ~4ms of synchronous,
	// event-loop-blocking CPU per log — ~1000x a normal log. On a hot error path that is
	// enough to peg a core and starve the daemon heartbeat. Tracking every object (errors
	// included) in `seen` collapses the cycle to '[Circular]' in O(1).
	if (seen.has(value)) return '[Circular]'
	seen.add(value)

	if (value instanceof Error) {
		return {
			...Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeForJson(entry, seen)])),
			name: value.name,
			message: value.message,
			stack: value.stack,
			cause: normalizeForJson(value.cause, seen),
		}
	}

	if (Array.isArray(value)) return value.map((item) => normalizeForJson(item, seen))

	return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeForJson(entry, seen)]))
}

export const defaultSerializers = [ErrorSerializer, RequestSerializer, ResponseSerializer, AnySerializer] as const
