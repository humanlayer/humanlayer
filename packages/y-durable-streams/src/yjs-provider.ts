// Derived from upstream YjsProvider 0.2.8. See README.md for provenance and local changes.
import { DurableStream, DurableStreamError, FetchError, IdempotentProducer } from '@durable-streams/client'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { ObservableV2 } from 'lib0/observable'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as Y from 'yjs'

export type HeadersRecord = Record<string, string | Promise<string> | (() => string | Promise<string>)>
export interface ResponseDocumentProviderOptions {
	doc: Y.Doc
	awareness: awarenessProtocol.Awareness
	baseUrl: string
	docId: string
	headers: HeadersRecord
	contentAccess: 'read-write' | 'read-only'
	retainedState?: Uint8Array
	connect?: boolean
	liveMode?: 'sse' | 'long-poll'
}
export type YjsProviderOptions = ResponseDocumentProviderOptions
export type YjsProviderStatus = 'disconnected' | 'connecting' | 'connected'
export interface YjsProviderEvents {
	access: (access: 'read-only' | 'access-lost') => void
	awarenessReady: () => void
	synced: (synced: boolean) => void
	status: (status: YjsProviderStatus) => void
	error: (error: Error) => void
}
interface ConnectionContext {
	publishing: boolean
	readAvailable: boolean
	awarenessReady: boolean
	controller: AbortController
	producer: IdempotentProducer | null
	work: Set<Promise<void>>
	subscriptions: Set<() => void>
	heartbeat: ReturnType<typeof setInterval> | null
	awarenessWrite: Promise<void>
}
const SERVER_ORIGIN = Symbol('yjs-server')
export const AWARENESS_HEARTBEAT_INTERVAL = 15_000

function frameUpdate(data: Uint8Array): Uint8Array {
	const encoder = encoding.createEncoder()
	encoding.writeVarUint8Array(encoder, data)
	return encoding.toUint8Array(encoder)
}
function waitForRetry(signal: AbortSignal, delay = 1_000): Promise<void> {
	return new Promise((resolve) => {
		const finish = () => {
			clearTimeout(timer)
			signal.removeEventListener('abort', finish)
			resolve()
		}
		const timer = setTimeout(finish, delay)
		signal.addEventListener('abort', finish, { once: true })
		if (signal.aborted) finish()
	})
}
function isMissing(error: unknown): boolean {
	return (
		(error instanceof DurableStreamError && error.code === 'NOT_FOUND') ||
		(error instanceof FetchError && error.status === 404)
	)
}

export class YjsProvider extends ObservableV2<YjsProviderEvents> {
	readonly doc: Y.Doc
	readonly awareness: awarenessProtocol.Awareness
	private readonly options: ResponseDocumentProviderOptions
	private ctx: ConnectionContext | null = null
	private state: YjsProviderStatus = 'disconnected'
	private destroyed = false
	private caughtUp = false
	private contentAccess: 'read-write' | 'read-only'
	private accessLost = false
	private localRevision = 0
	private retryController: AbortController | null = null
	private retryAttempt = 0
	private lifecycleRevision = 0

	constructor(options: ResponseDocumentProviderOptions) {
		super()
		this.options = options
		this.contentAccess = options.contentAccess
		this.doc = options.doc
		this.awareness = options.awareness
		if (options.retainedState) Y.applyUpdate(this.doc, options.retainedState, SERVER_ORIGIN)
		this.doc.on('update', this.handleDocumentUpdate)
		this.awareness.on('update', this.handleAwarenessUpdate)
		if (options.connect !== false) void this.connect()
	}
	get connected() {
		return this.state === 'connected'
	}
	get connecting() {
		return this.state === 'connecting'
	}
	get synced() {
		return this.caughtUp
	}
	private transition(state: YjsProviderStatus) {
		this.state = state
		this.emit('status', [state])
	}
	private isStale(ctx: ConnectionContext) {
		return this.ctx !== ctx || ctx.controller.signal.aborted
	}
	private docUrl() {
		return `${this.options.baseUrl.replace(/\/+$/, '')}/docs/${this.options.docId}`
	}

	// Resolve at the actual network boundary, not only once when the SDK builds retry headers.
	private authenticatedFetch = Object.assign(async (input: string | Request | URL, init?: RequestInit) => {
		const ctx = this.ctx
		const headers = new Headers(init?.headers)
		for (const [key, value] of Object.entries(this.options.headers))
			headers.set(key, await (typeof value === 'function' ? value() : value))
		init?.signal?.throwIfAborted()
		const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
		const documentRequest = !url.searchParams.has('awareness')
		const method = init?.method ?? 'GET'
		let response: Response
		try {
			response = await globalThis.fetch(input, { ...init, headers })
		} catch (error) {
			if (ctx && !this.isStale(ctx) && documentRequest && method === 'GET') this.pauseDocument()
			throw error
		}
		if (ctx && !this.isStale(ctx)) {
			// The SDK treats *every* 403 as an epoch conflict. Only a valid,
			// advancing protocol epoch may reach autoClaim; proxy denials have none.
			const epoch = response.headers.get('producer-epoch')
			const staleEpoch =
				method === 'POST' &&
				headers.has('producer-id') &&
				epoch !== null &&
				/^\d+$/.test(epoch) &&
				Number.isSafeInteger(Number(epoch)) &&
				Number(epoch) > Number(headers.get('producer-epoch'))
			if (response.status === 401 || (response.status === 403 && !staleEpoch)) {
				const access =
					response.status === 403 && documentRequest && ['PUT', 'POST'].includes(method)
						? 'read-only'
						: 'access-lost'
				// Preserve HTTP status even when a denied response body cannot be read.
				const error = new FetchError(response.status, undefined, undefined, {}, url.href)
				void response.body?.cancel().catch(() => {})
				this.failConnection(ctx, error, access)
				throw error
			}
			if (documentRequest && method === 'GET' && (response.status === 429 || response.status >= 500))
				this.pauseDocument()
		}
		return response
	}, globalThis.fetch)
	private pauseDocument() {
		if (this.ctx) this.ctx.readAvailable = false
		this.caughtUp = false
		this.transition('connecting')
		this.emit('synced', [false])
	}
	private failConnection(ctx: ConnectionContext, error: unknown, access?: 'read-only' | 'access-lost') {
		if (this.isStale(ctx)) return
		const status = error instanceof FetchError || error instanceof DurableStreamError ? error.status : undefined
		const retryable =
			isMissing(error) ||
			error instanceof TypeError ||
			(status !== undefined && (status < 400 || status === 429 || status >= 500))
		const stopped = this.disconnect()
		const lifecycleRevision = this.lifecycleRevision
		this.emit('error', [error instanceof Error ? error : new Error(String(error))])
		if (access) {
			this.accessLost = access === 'access-lost'
			this.contentAccess = 'read-only'
			this.emit('access', [access])
		}
		if (
			this.destroyed ||
			this.accessLost ||
			lifecycleRevision !== this.lifecycleRevision ||
			(!access && !retryable)
		)
			return
		const retry = new AbortController()
		this.retryController = retry
		const delay = access ? 0 : Math.min(10_000, 250 * 2 ** Math.min(this.retryAttempt++, 6))
		void Promise.all([stopped, waitForRetry(retry.signal, delay)]).then(() => {
			if (retry.signal.aborted || this.retryController !== retry) return
			this.retryController = null
			void this.connect()
		})
	}
	private stream(ctx: ConnectionContext, awareness = false) {
		return new DurableStream({
			url: `${this.docUrl()}${awareness ? '?awareness=default' : ''}`,
			contentType: 'application/octet-stream',
			fetch: this.authenticatedFetch,
			signal: ctx.controller.signal,
		})
	}
	private track(ctx: ConnectionContext, work: Promise<void>) {
		const tracked = work.catch((error) => {
			this.failConnection(ctx, error)
		})
		ctx.work.add(tracked)
		void tracked.then(() => ctx.work.delete(tracked))
	}
	async connect(): Promise<void> {
		if (this.destroyed || this.accessLost || this.ctx) return
		this.retryController?.abort()
		this.retryController = null
		const ctx: ConnectionContext = {
			publishing: false,
			readAvailable: false,
			awarenessReady: false,
			controller: new AbortController(),
			producer: null,
			work: new Set(),
			subscriptions: new Set(),
			heartbeat: null,
			awarenessWrite: Promise.resolve(),
		}
		this.ctx = ctx
		this.transition('connecting')
		const start = async () => {
			if (this.contentAccess === 'read-write') await this.ensureStream(ctx, false)
			if (this.isStale(ctx)) return
			await this.ensureStream(ctx, true)
			if (this.isStale(ctx)) return
			if (this.contentAccess === 'read-write')
				ctx.producer = new IdempotentProducer(
					this.stream(ctx),
					`${this.options.docId}-${crypto.randomUUID()}`,
					{
						autoClaim: true,
						maxInFlight: 1,
						signal: ctx.controller.signal,
						fetch: this.authenticatedFetch,
						onError: (error) => this.failConnection(ctx, error),
					},
				)
			this.track(ctx, this.runUpdatesStream(ctx, false))
			this.track(ctx, this.runUpdatesStream(ctx, true))
			this.sendAwareness(ctx)
			ctx.heartbeat = setInterval(() => this.sendAwareness(ctx), AWARENESS_HEARTBEAT_INTERVAL)
		}
		const started = start()
		this.track(ctx, started)
		// Failures are reported by the owned error event; connect never leaves an unhandled rejection.
		await started.catch(() => {})
	}
	private async ensureStream(ctx: ConnectionContext, awareness: boolean) {
		const response = await this.authenticatedFetch(`${this.docUrl()}${awareness ? '?awareness=default' : ''}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/octet-stream' },
			signal: ctx.controller.signal,
		})
		if (response.status !== 200 && response.status !== 201)
			throw await FetchError.fromResponse(response, this.docUrl())
		await response.arrayBuffer()
	}
	private async runUpdatesStream(ctx: ConnectionContext, awareness: boolean) {
		let offset = awareness ? 'now' : '-1'
		while (!this.isStale(ctx)) {
			let unsubscribe: (() => void) | undefined
			try {
				const response = await this.stream(ctx, awareness).stream({
					offset,
					live: this.options.liveMode ?? 'sse',
					signal: ctx.controller.signal,
				})
				unsubscribe = response.subscribeBytes((chunk) => {
					if (this.isStale(ctx)) return
					offset = chunk.offset
					const decoder = decoding.createDecoder(chunk.data)
					while (decoding.hasContent(decoder)) {
						const update = decoding.readVarUint8Array(decoder)
						if (awareness) awarenessProtocol.applyAwarenessUpdate(this.awareness, update, SERVER_ORIGIN)
						else Y.applyUpdate(this.doc, update, SERVER_ORIGIN)
					}
					if (awareness && chunk.upToDate && !ctx.awarenessReady) {
						ctx.awarenessReady = true
						this.emit('awarenessReady', [])
					}
					if (!awareness && chunk.upToDate) {
						ctx.readAvailable = true
						if (!this.caughtUp && !ctx.publishing) this.track(ctx, this.publishRetainedState(ctx))
					}
				})
				ctx.subscriptions.add(unsubscribe)
				await response.closed
			} catch (error) {
				if (this.isStale(ctx)) return
				if (!(isMissing(error) && !awareness && this.contentAccess === 'read-only')) throw error
				this.pauseDocument()
				offset = '-1'
				await waitForRetry(ctx.controller.signal)
			} finally {
				if (unsubscribe) {
					unsubscribe()
					ctx.subscriptions.delete(unsubscribe)
				}
			}
		}
	}
	private async publishRetainedState(ctx: ConnectionContext) {
		ctx.publishing = true
		try {
			if (ctx.producer) {
				// Replay has merged remote state. Publish on every connection, not
				// just the creator's PUT. Repeat if local edits raced the acknowledgement.
				let revision: number
				do {
					revision = this.localRevision
					ctx.producer.append(frameUpdate(Y.encodeStateAsUpdate(this.doc)))
					await ctx.producer.flush()
					// SDK flush drains the queue; onError (not flush) reports failed POSTs.
					if (this.isStale(ctx)) return
				} while (revision !== this.localRevision)
			}
			if (this.isStale(ctx) || !ctx.readAvailable) return
			this.retryAttempt = 0
			this.caughtUp = true
			this.transition('connected')
			this.emit('synced', [true])
		} finally {
			ctx.publishing = false
		}
	}
	private handleDocumentUpdate = (update: Uint8Array, origin: unknown) => {
		if (origin === SERVER_ORIGIN) return
		this.localRevision++
		if (!this.connected) return
		this.ctx?.producer?.append(frameUpdate(update))
	}
	private handleAwarenessUpdate = (
		update: { added: number[]; updated: number[]; removed: number[] },
		origin: unknown,
	) => {
		if (origin === SERVER_ORIGIN || !this.ctx) return
		if ([...update.added, ...update.updated, ...update.removed].includes(this.awareness.clientID))
			this.sendAwareness(this.ctx)
	}
	private sendAwareness(ctx: ConnectionContext) {
		if (this.isStale(ctx)) return
		const write = ctx.awarenessWrite.then(async () => {
			if (this.isStale(ctx)) return
			const data = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])
			await this.stream(ctx, true).append(frameUpdate(data), { signal: ctx.controller.signal })
		})
		ctx.awarenessWrite = write.catch(() => {})
		this.track(ctx, write)
	}
	async flush() {
		await this.ctx?.producer?.flush()
		await this.ctx?.awarenessWrite
	}
	async disconnect(): Promise<void> {
		this.lifecycleRevision++
		this.retryController?.abort()
		this.retryController = null
		const ctx = this.ctx
		if (!ctx) return
		this.ctx = null
		this.caughtUp = false
		this.transition('disconnected')
		this.emit('synced', [false])
		// Abort before detach: teardown must not flush queued content after permission loss.
		ctx.controller.abort()
		if (ctx.heartbeat !== null) clearInterval(ctx.heartbeat)
		for (const unsubscribe of ctx.subscriptions) unsubscribe()
		ctx.subscriptions.clear()
		await ctx.producer?.detach()
		await Promise.all(ctx.work)
	}
	override destroy(): void {
		if (this.destroyed) return
		// Capture a higher-clock tombstone before destroying Awareness. This request
		// is independent of content teardown and bounded; navigation never awaits it.
		if (this.ctx) {
			this.awareness.setLocalState(null)
			const data = frameUpdate(awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]))
			void this.authenticatedFetch(`${this.docUrl()}?awareness=default`, {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: new Uint8Array(data),
				signal: AbortSignal.timeout(1_000),
			})
				.then((response) => response.body?.cancel())
				.catch(() => {})
		}
		this.destroyed = true
		void this.disconnect()
		this.doc.off('update', this.handleDocumentUpdate)
		this.awareness.off('update', this.handleAwarenessUpdate)
		super.destroy()
	}
}
