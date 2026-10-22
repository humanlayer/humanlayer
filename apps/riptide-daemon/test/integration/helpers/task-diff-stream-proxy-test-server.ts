import { createServer, type Server } from 'node:http'

export interface ObservedTaskDiffProxyRequest {
	readonly method: string
	readonly path: string
	readonly daemonAuthorization: string | undefined
	readonly producerId: string | undefined
	readonly expiresAt: string | undefined
	readonly ttl: string | undefined
}

const firstHeader = (value: string | ReadonlyArray<string> | undefined): string | undefined =>
	typeof value === 'string' ? value : value?.[0]

/** Minimal local proxy that exercises the production /v2/streams -> /v1/stream rewrite. */
export class TaskDiffStreamProxyTestServer {
	readonly requests: ObservedTaskDiffProxyRequest[] = []
	failNextHeadRequests = 0
	private server: Server | undefined
	private origin: string | undefined

	constructor(private readonly durableStreamsOrigin: string) {}

	get url(): string {
		if (!this.origin) throw new Error('Task diff stream proxy has not started')
		return this.origin
	}

	async start(): Promise<void> {
		this.server = createServer(async (request, response) => {
			try {
				const incomingPath = request.url ?? '/'
				const method = request.method ?? 'GET'
				this.requests.push({
					method,
					path: incomingPath,
					daemonAuthorization: firstHeader(request.headers['x-daemon-authorization']),
					producerId: firstHeader(request.headers['producer-id']),
					expiresAt: firstHeader(request.headers['stream-expires-at']),
					ttl: firstHeader(request.headers['stream-ttl']),
				})
				if (method === 'HEAD' && this.failNextHeadRequests > 0) {
					this.failNextHeadRequests -= 1
					response.writeHead(502, { 'content-type': 'application/json' })
					response.end(JSON.stringify({ error: 'Forced HEAD failure' }))
					return
				}
				const chunks: Buffer[] = []
				for await (const chunk of request) chunks.push(Buffer.from(chunk))
				const body = Buffer.concat(chunks)
				const headers = new Headers()
				for (const [name, value] of Object.entries(request.headers)) {
					if (value === undefined || name === 'host' || name === 'connection' || name === 'content-length')
						continue
					headers.set(name, Array.isArray(value) ? value.join(', ') : value)
				}
				const upstreamPath = incomingPath.replace(/^\/v2\/streams\//, '/v1/stream/')
				const upstreamResponse = await fetch(`${this.durableStreamsOrigin}${upstreamPath}`, {
					method,
					headers,
					body: method === 'GET' || method === 'HEAD' || body.length === 0 ? undefined : body,
				})
				response.writeHead(upstreamResponse.status, Object.fromEntries(upstreamResponse.headers.entries()))
				response.end(Buffer.from(await upstreamResponse.arrayBuffer()))
			} catch (error: unknown) {
				response.writeHead(502, { 'content-type': 'application/json' })
				response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Proxy failure' }))
			}
		})
		await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve))
		const address = this.server.address()
		if (!address || typeof address === 'string') throw new Error('Expected task diff proxy TCP address')
		this.origin = `http://127.0.0.1:${address.port}`
	}

	async stop(): Promise<void> {
		const server = this.server
		if (!server) return
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		this.server = undefined
		this.origin = undefined
	}
}
