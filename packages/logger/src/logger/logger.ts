import type { LogTransport } from './abstract-transport'
import { defaultSerializers, type Serializer } from './serialize'
import { type JsonObject, type JsonValue, type LogLevel, logLevels } from './types'
import './json-stringification-patches'
export type LoggerProps = {
	transports: [LogTransport, ...Array<LogTransport>] // forces at least 1
	name?: string
	properties: Record<string, string>
	onTransportError?: (err: unknown) => void | Promise<void>
	additionalSerializers?: Array<Serializer>
}

type LoggerState = {
	pending: Set<Promise<void>>
}

export class Logger {
	public name: LoggerProps['name']
	protected transports: LoggerProps['transports']
	protected properties: Record<string, string>

	protected onTransportError: (err: unknown) => void | Promise<void>
	protected additionalSerializers: Array<Serializer> = []
	private state: LoggerState

	constructor(options: LoggerProps) {
		this.name = options.name
		this.transports = options.transports
		this.properties = options.properties
		this.onTransportError = options.onTransportError ?? ((_e: unknown) => {})
		this.additionalSerializers = options.additionalSerializers ?? []
		this.state = { pending: new Set() }
	}

	private async send(event: { msg?: string; data?: JsonValue; level: LogLevel }) {
		const timestamp = Date.now()
		const pendingSends: Array<Promise<void>> = []
		for (const transport of this.transports) {
			try {
				// ensure that the event level matches or is above the transport level before logging
				if (logLevels[event.level] >= logLevels[transport.level]) {
					const sendResult = transport.send({
						msg: event.msg,
						data: event.data,
						logger: this.name,
						level: event.level,
						timestamp,
					})
					if (sendResult) {
						pendingSends.push(sendResult.catch((error: unknown) => this.handleTransportError(error)))
					}
				}
			} catch (error: unknown) {
				this.handleTransportError(error)
			}
		}
		await Promise.all(pendingSends)
	}

	private handleTransportError(error: unknown) {
		try {
			const handlerResult = this.onTransportError(error)
			if (handlerResult) void handlerResult.catch(() => {})
		} catch {
			// nothing we can do here except prevent from erroring
		}
	}

	public async flush() {
		while (this.state.pending.size > 0) {
			await Promise.allSettled(this.state.pending)
		}
	}

	public async shutdown() {
		await this.flush()
		await Promise.allSettled(this.transports.map((t) => Promise.resolve(t.shutdown())))
	}

	/**
	 * Creates a child logger with the same transports but a logger name that appears in the log, good for separating logical concerns
	 * & enhancing grep-ability
	 * @param name - the name of the child logger
	 * @param properties - any metadata that should _always_ be logged with the request e.g. a request ID
	 * @returns
	 */
	public child(name: string, properties?: Record<string, string>) {
		const child = new Logger({
			name: name ?? this.name,
			properties: { ...this.properties, ...properties },
			transports: this.transports,
			additionalSerializers: this.additionalSerializers,
			onTransportError: this.onTransportError,
		})
		child.state = this.state
		return child
	}

	private genLog(level: LogLevel) {
		const serializers = [...this.additionalSerializers, ...defaultSerializers]
		return (...args: unknown[]): void => {
			const dispatch = this.dispatch(level, serializers, args).catch((error: unknown) =>
				this.handleTransportError(error),
			)
			this.state.pending.add(dispatch)
			void dispatch.finally(() => this.state.pending.delete(dispatch))
		}
	}

	private async dispatch(level: LogLevel, serializers: Array<Serializer>, args: unknown[]): Promise<void> {
		const strings: string[] = []
		const objects: unknown[] = []
		let firstError: Error | undefined

		// Separate strings from objects/errors
		for (const arg of args) {
			if (typeof arg === 'string') {
				strings.push(arg)
			} else if (typeof arg === 'number' || typeof arg === 'boolean') {
				// Convert primitives to strings for the message
				strings.push(String(arg))
			} else if (arg !== null && arg !== undefined) {
				// Track first error for message fallback
				if (arg instanceof Error && !firstError) {
					firstError = arg
				}
				objects.push(arg)
			}
		}

		// Build message: join strings, or use first error's message as fallback
		const message = strings.length > 0 ? strings.join(' ') : firstError?.message

		// Serialize objects inline so console logs stay compact and grep-friendly.
		const serializedObjects =
			objects.length > 0
				? await Promise.all(objects.map((obj) => serializeObject(obj, level, serializers)))
				: undefined
		const data = buildLogData(this.properties, serializedObjects)

		await this.send({
			level,
			msg: message,
			data,
		})
	}

	public silly = this.genLog('silly')
	public debug = this.genLog('debug')
	public http = this.genLog('http')
	public info = this.genLog('info')
	public warn = this.genLog('warn')
	public error = this.genLog('error')
	public fatal = this.genLog('fatal')
}

async function serializeObject(o: unknown, l: LogLevel, serializers?: Array<Serializer>) {
	const s = serializers ?? defaultSerializers
	try {
		for (let i = 0; i < s.length; i++) {
			if (s[i]?.shouldSerialize(o)) return await Promise.resolve(s[i]?.serialize(o, l))
		}
		return JSON.parse(JSON.stringify(o))
	} catch {
		// nothing we can do
		return { serializeError: 'Unable to serialize passed object' }
	}
}

function buildLogData(
	properties: Record<string, string>,
	serializedObjects?: Array<JsonValue>,
): JsonObject | undefined {
	const data: JsonObject = { ...properties }

	if (serializedObjects && serializedObjects.length > 0) {
		data.data = serializedObjects
	}

	return Object.keys(data).length > 0 ? data : undefined
}
