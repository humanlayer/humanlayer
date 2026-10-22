import { once } from 'node:events'

import { DurableStreamTestServer } from '@durable-streams/server'
import { serve } from '@hono/node-server'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { YjsGateway, YjsGatewayLive, YjsStorageConfig } from '../src/server'
import { YjsProvider, type ResponseDocumentProviderOptions } from '../src/yjs-provider'

/** Real HTTP boundary: the runtime bridges server callbacks, not test assertions. */
export const startGateway = () => startGatewayWithOptions()

export async function startGatewayWithOptions(options?: {
	translateRequest?: (request: Request) => Promise<Request>
	intercept?: (request: Request, forward: () => Promise<Response>) => Promise<Response>
}) {
	const storage = new DurableStreamTestServer({ port: 0, host: '127.0.0.1' })
	await storage.start()
	const runtime = ManagedRuntime.make(
		YjsGatewayLive.pipe(
			Layer.provide(FetchHttpClient.layer),
			Layer.provide(Layer.succeed(YjsStorageConfig, { baseUrl: storage.url })),
		),
	)
	const requests: { method: string; url: URL; authorization: string | null }[] = []
	const reads = new Set<AbortController>()
	const server = serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch: async (request) => {
			requests.push({
				method: request.method,
				url: new URL(request.url),
				authorization: request.headers.get('authorization'),
			})
			const forward = async () => {
				const translated = options?.translateRequest ? await options.translateRequest(request) : request
				const controller = new AbortController()
				if (request.method === 'GET') reads.add(controller)
				request.signal.addEventListener('abort', () => reads.delete(controller), { once: true })
				return runtime.runPromise(
					YjsGateway.use((gateway) =>
						gateway.handle(translated, AbortSignal.any([request.signal, controller.signal])),
					),
				)
			}
			return options?.intercept ? options.intercept(request, forward) : forward()
		},
	})
	if (!server.listening) await once(server, 'listening')
	const address = server.address()
	if (!address || typeof address === 'string') throw new Error('Missing test server port')
	return {
		baseUrl: `http://127.0.0.1:${address.port}/v1/yjs/tests`,
		storage,
		requests,
		interruptConnections: () => {
			for (const controller of reads) controller.abort()
			reads.clear()
		},
		stop: async () => {
			await runtime.dispose()
			if ('closeAllConnections' in server) server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
			await storage.stop()
		},
	}
}

export function createProvider(baseUrl: string, docId: string, options: Partial<ResponseDocumentProviderOptions> = {}) {
	const doc = new Y.Doc()
	const awareness = new Awareness(doc)
	const provider = new YjsProvider({
		doc,
		awareness,
		baseUrl,
		docId,
		headers: { Authorization: 'Bearer test' },
		contentAccess: 'read-write',
		connect: false,
		...options,
	})
	return {
		provider,
		doc,
		awareness,
		stop: async () => {
			await provider.disconnect()
			provider.destroy()
			awareness.destroy()
			doc.destroy()
		},
	}
}

export const awaitSynced = (provider: YjsProvider) =>
	Effect.callback<void, Error>((resume) => {
		if (provider.synced) {
			resume(Effect.void)
			return
		}
		const synced = (value: boolean) => {
			if (value) resume(Effect.void)
		}
		const failed = (error: Error) => resume(Effect.fail(error))
		provider.on('synced', synced)
		provider.on('error', failed)
		return Effect.sync(() => {
			provider.off('synced', synced)
			provider.off('error', failed)
		})
	})

export const awaitText = (doc: Y.Doc, expected: string) =>
	Effect.callback<void>((resume) => {
		const updated = () => {
			if (doc.getText('text').toString() === expected) resume(Effect.void)
		}
		doc.on('update', updated)
		updated()
		return Effect.sync(() => doc.off('update', updated))
	})
