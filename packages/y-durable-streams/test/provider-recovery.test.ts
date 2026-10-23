import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { expect } from 'vitest'
import * as Y from 'yjs'

import { type YjsProvider } from '../src/yjs-provider'
import { awaitSynced, awaitText, createProvider, startGatewayWithOptions } from './fixtures'

const providerResource = (baseUrl: string, id: string, options: Parameters<typeof createProvider>[2] = {}) =>
	Effect.acquireRelease(
		Effect.sync(() => createProvider(baseUrl, id, options)),
		(p) => Effect.promise(p.stop),
	)
const gatewayResource = (options?: Parameters<typeof startGatewayWithOptions>[0]) =>
	Effect.acquireRelease(
		Effect.promise(() => startGatewayWithOptions(options)),
		(g) => Effect.promise(g.stop),
	)
const syncedAfterRecovery = (provider: YjsProvider) =>
	Effect.callback<void>((resume) => {
		const synced = (ready: boolean) => {
			if (ready) resume(Effect.void)
		}
		provider.on('synced', synced)
		if (provider.synced) resume(Effect.void)
		return Effect.sync(() => provider.off('synced', synced))
	})
const accessChanged = (provider: YjsProvider, expected: 'read-only' | 'access-lost') =>
	Effect.callback<void>((resume) => {
		const access = (value: 'read-only' | 'access-lost') => {
			if (value === expected) resume(Effect.void)
		}
		provider.on('access', access)
		return Effect.sync(() => provider.off('access', access))
	})

describe('retained document publication and recovery', () => {
	for (const existing of [false, true])
		it.effect(`publishes prepopulated state after replay (existing=${existing})`, () =>
			Effect.gen(function* () {
				const gateway = yield* gatewayResource()
				const id = randomUUID()
				if (existing) {
					const seed = yield* providerResource(gateway.baseUrl, id)
					seed.doc.getText('remote').insert(0, 'remote')
					yield* Effect.promise(() => seed.provider.connect())
					yield* awaitSynced(seed.provider)
					yield* Effect.promise(() => seed.provider.disconnect())
				}
				const writer = yield* providerResource(gateway.baseUrl, id)
				writer.doc.getText('text').insert(0, 'retained')
				yield* Effect.promise(() => writer.provider.connect())
				yield* awaitSynced(writer.provider)
				const fresh = yield* providerResource(gateway.baseUrl, id, { contentAccess: 'read-only' })
				yield* Effect.promise(() => fresh.provider.connect())
				yield* awaitSynced(fresh.provider)
				expect(fresh.doc.getText('text').toString()).toBe('retained')
				expect(fresh.doc.getText('remote').toString()).toBe(existing ? 'remote' : '')
			}),
		)

	it.effect('includes edits during catchup and held full-state acknowledgement before readiness', () =>
		Effect.gen(function* () {
			const readReached = Promise.withResolvers<void>()
			const readRelease = Promise.withResolvers<void>()
			const postReached = Promise.withResolvers<void>()
			const postRelease = Promise.withResolvers<void>()
			let holdRead = true
			let holdPost = true
			const gateway = yield* gatewayResource({
				intercept: async (request, forward) => {
					if (!new URL(request.url).searchParams.has('awareness')) {
						if (request.method === 'GET' && holdRead) {
							holdRead = false
							readReached.resolve()
							await readRelease.promise
						}
						if (request.method === 'POST' && holdPost) {
							holdPost = false
							const response = await forward()
							postReached.resolve()
							await postRelease.promise
							return response
						}
					}
					return forward()
				},
			})
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					readRelease.resolve()
					postRelease.resolve()
				}),
			)
			const id = randomUUID()
			const writer = yield* providerResource(gateway.baseUrl, id)
			writer.doc.getText('text').insert(0, 'before')
			yield* Effect.promise(() => writer.provider.connect())
			yield* Effect.promise(() => readReached.promise)
			writer.doc.getText('text').insert(6, '-catchup')
			readRelease.resolve()
			yield* Effect.promise(() => postReached.promise)
			expect(writer.provider.synced).toBe(false)
			writer.doc.getText('text').insert(14, '-publication')
			postRelease.resolve()
			yield* awaitSynced(writer.provider)
			const reader = yield* providerResource(gateway.baseUrl, id, { contentAccess: 'read-only' })
			yield* Effect.promise(() => reader.provider.connect())
			yield* awaitSynced(reader.provider)
			expect(reader.doc.getText('text').toString()).toBe('before-catchup-publication')
		}),
	)

	for (const fault of ['PUT', 'POST', 'uncertain POST'] as const)
		it.live(`recovers transient ${fault} and republishes all state`, () =>
			Effect.gen(function* () {
				let failed = false
				const gateway = yield* gatewayResource({
					intercept: async (request, forward) => {
						if (
							!failed &&
							!new URL(request.url).searchParams.has('awareness') &&
							request.method === (fault === 'PUT' ? 'PUT' : 'POST')
						) {
							failed = true
							if (fault === 'uncertain POST') {
								const accepted = await forward()
								await accepted.arrayBuffer()
							}
							return new Response(null, { status: 503 })
						}
						return forward()
					},
				})
				const id = randomUUID()
				const writer = yield* providerResource(gateway.baseUrl, id)
				writer.doc.getText('text').insert(0, 'must survive')
				yield* Effect.promise(() => writer.provider.connect())
				yield* syncedAfterRecovery(writer.provider)
				expect(failed).toBe(true)
				const reader = yield* providerResource(gateway.baseUrl, id, { contentAccess: 'read-only' })
				yield* Effect.promise(() => reader.provider.connect())
				yield* awaitSynced(reader.provider)
				expect(reader.doc.getText('text').toString()).toBe('must survive')
			}),
		)

	it.live(
		'an uncertain connected save and later local edit survive reconnect without producer-sequence deduplication loss',
		() =>
			Effect.gen(function* () {
				let failNext = false
				const gateway = yield* gatewayResource({
					intercept: async (request, forward) => {
						const response = await forward()
						if (
							failNext &&
							request.method === 'POST' &&
							!new URL(request.url).searchParams.has('awareness')
						) {
							failNext = false
							await response.arrayBuffer()
							return new Response(null, { status: 502 })
						}
						return response
					},
				})
				const id = randomUUID()
				const writer = yield* providerResource(gateway.baseUrl, id)
				writer.doc.getText('text').insert(0, 'initial')
				yield* Effect.promise(() => writer.provider.connect())
				yield* awaitSynced(writer.provider)
				failNext = true
				writer.doc.getText('text').insert(7, '-uncertain')
				yield* Effect.promise(() => writer.provider.flush())
				expect(writer.provider.synced).toBe(false)
				writer.doc.getText('text').insert(17, '-offline')
				yield* syncedAfterRecovery(writer.provider)
				const fresh = yield* providerResource(gateway.baseUrl, id, { contentAccess: 'read-only' })
				yield* Effect.promise(() => fresh.provider.connect())
				yield* awaitSynced(fresh.provider)
				expect(fresh.doc.getText('text').toString()).toBe('initial-uncertain-offline')
			}),
	)

	it.live('recovers an escaped catchup response-body failure through real HTTP', () =>
		Effect.gen(function* () {
			let failed = false
			const gateway = yield* gatewayResource({
				intercept: async (request, forward) => {
					if (!failed && request.method === 'GET' && !new URL(request.url).searchParams.has('awareness')) {
						failed = true
						// A truncated HTTP body, not a rejected fetch stub. The SDK has
						// already received success headers when arrayBuffer fails.
						return new Response(new Uint8Array([0]), {
							headers: {
								'content-length': '100',
								'content-type': 'application/octet-stream',
								'stream-next-offset': '0000000000000000_0000000000000000',
								'stream-up-to-date': 'true',
							},
						})
					}
					return forward()
				},
			})
			const writer = yield* providerResource(gateway.baseUrl, randomUUID())
			writer.doc.getText('text').insert(0, 'retained')
			const errors: Error[] = []
			writer.provider.on('error', (error) => errors.push(error))
			yield* Effect.promise(() => writer.provider.connect())
			yield* syncedAfterRecovery(writer.provider)
			expect(errors.length).toBeGreaterThan(0)
			expect(
				gateway.requests.filter((r) => r.method === 'PUT' && !r.url.searchParams.has('awareness')).length,
			).toBe(2)
		}),
	)

	for (const action of ['disconnect', 'destroy'] as const)
		it.live(`cancels retry resources on ${action}`, () =>
			Effect.gen(function* () {
				const gateway = yield* gatewayResource({ intercept: async () => new Response(null, { status: 503 }) })
				const writer = yield* providerResource(gateway.baseUrl, randomUUID())
				yield* Effect.promise(() => writer.provider.connect())
				if (action === 'destroy') writer.provider.destroy()
				else yield* Effect.promise(() => writer.provider.disconnect())
				const count = gateway.requests.length
				// Negative timing assertion: exceed the newly scheduled 250ms retry.
				yield* Effect.sleep('400 millis')
				expect(gateway.requests.length).toBe(count)
				expect(writer.provider.connecting).toBe(false)
			}),
		)

	it.live('only protocol epoch conflicts reach auto-claim; bootstrap 401 is terminal', () =>
		Effect.gen(function* () {
			let epochConflicts = 0
			const gateway = yield* gatewayResource({
				intercept: async (request, forward) => {
					if (request.headers.get('authorization') === 'denied') return new Response(null, { status: 401 })
					if (
						request.method === 'POST' &&
						!new URL(request.url).searchParams.has('awareness') &&
						epochConflicts++ === 0
					)
						return new Response(null, { status: 403, headers: { 'producer-epoch': '1' } })
					return forward()
				},
			})
			const writer = yield* providerResource(gateway.baseUrl, randomUUID())
			yield* Effect.promise(() => writer.provider.connect())
			yield* awaitSynced(writer.provider)
			expect(epochConflicts).toBe(2)
			const denied = yield* providerResource(gateway.baseUrl, randomUUID(), {
				headers: { Authorization: 'denied' },
			})
			const lost = yield* accessChanged(denied.provider, 'access-lost').pipe(Effect.forkChild)
			yield* Effect.promise(() => denied.provider.connect())
			yield* Fiber.join(lost)
			yield* Effect.promise(() => denied.provider.connect())
			expect(gateway.requests.filter((r) => r.authorization === 'denied')).toHaveLength(1)
		}),
	)

	it.live(
		'recovers a missing connected stream with concurrent writers, deletion and an old copy; viewer never writes',
		() =>
			Effect.gen(function* () {
				const gateway = yield* gatewayResource()
				const id = randomUUID()
				const a = yield* providerResource(gateway.baseUrl, id)
				a.doc.getText('text').insert(0, 'deleted')
				yield* Effect.promise(() => a.provider.connect())
				yield* awaitSynced(a.provider)
				const oldState = Y.encodeStateAsUpdate(a.doc)
				const viewer = yield* providerResource(gateway.baseUrl, id, {
					contentAccess: 'read-only',
					headers: { Authorization: 'viewer' },
				})
				yield* Effect.promise(() => viewer.provider.connect())
				yield* awaitSynced(viewer.provider)
				yield* Effect.promise(() => a.provider.disconnect())
				a.doc.getText('text').delete(0, 7)
				const b = yield* providerResource(gateway.baseUrl, id, { retainedState: oldState })
				b.doc.getText('other').insert(0, 'B')
				const removed = yield* Effect.promise(() =>
					fetch(`${gateway.storage.url}/v1/stream/yjs/tests/docs/${id}/.updates`, { method: 'DELETE' }),
				)
				expect(removed.status).toBe(204)
				gateway.interruptConnections()
				// Viewer observes absence before any writer recreates the document.
				yield* Effect.callback<void>((resume) => {
					const paused = (status: string) => {
						if (status === 'connecting') resume(Effect.void)
					}
					viewer.provider.on('status', paused)
					return Effect.sync(() => viewer.provider.off('status', paused))
				})
				yield* Effect.promise(() => Promise.all([a.provider.connect(), b.provider.connect()]))
				yield* Effect.all(
					[
						syncedAfterRecovery(a.provider),
						syncedAfterRecovery(b.provider),
						syncedAfterRecovery(viewer.provider),
					],
					{ concurrency: 3 },
				)
				yield* awaitText(b.doc, '')
				// A connected writer loses its stream too, then an edit observes POST 404.
				const removedAgain = yield* Effect.promise(() =>
					fetch(`${gateway.storage.url}/v1/stream/yjs/tests/docs/${id}/.updates`, { method: 'DELETE' }),
				)
				expect(removedAgain.status).toBe(204)
				a.doc.getText('other').insert(0, 'A')
				yield* Effect.promise(() => a.provider.flush())
				yield* syncedAfterRecovery(a.provider)
				gateway.interruptConnections()
				const fresh = yield* providerResource(gateway.baseUrl, id, { contentAccess: 'read-only' })
				yield* Effect.promise(() => fresh.provider.connect())
				yield* awaitSynced(fresh.provider)
				expect(fresh.doc.getText('text').toString()).toBe('')
				expect(fresh.doc.getText('other').toString()).toBe('AB')
				expect(
					gateway.requests.filter(
						(r) =>
							r.authorization === 'viewer' &&
							['PUT', 'POST'].includes(r.method) &&
							!r.url.searchParams.has('awareness'),
					),
				).toEqual([])
			}),
	)

	it.live('document permission denial downgrades once; read denial stops all transport', () =>
		Effect.gen(function* () {
			let denyWrites = false
			let denyAll = false
			let deniedPosts = 0
			const gateway = yield* gatewayResource({
				intercept: async (request, forward) => {
					if (
						denyAll ||
						(denyWrites &&
							!new URL(request.url).searchParams.has('awareness') &&
							['PUT', 'POST'].includes(request.method))
					) {
						if (request.method === 'POST') deniedPosts++
						return new Response(null, { status: 403 })
					}
					return forward()
				},
			})
			const writer = yield* providerResource(gateway.baseUrl, randomUUID())
			yield* Effect.promise(() => writer.provider.connect())
			yield* awaitSynced(writer.provider)
			denyWrites = true
			const downgraded = yield* accessChanged(writer.provider, 'read-only').pipe(Effect.forkChild)
			writer.doc.getText('text').insert(0, 'not accepted')
			yield* Effect.promise(() => writer.provider.flush())
			yield* Fiber.join(downgraded)
			yield* syncedAfterRecovery(writer.provider)
			expect(deniedPosts).toBe(1)
			writer.doc.getText('text').insert(0, 'still local')
			yield* Effect.promise(() => writer.provider.flush())
			expect(deniedPosts).toBe(1)
			denyAll = true
			const lost = yield* accessChanged(writer.provider, 'access-lost').pipe(Effect.forkChild)
			writer.awareness.setLocalStateField('user', { memberId: 'writer' })
			yield* Effect.promise(() => writer.provider.flush())
			yield* Fiber.join(lost)
			const count = gateway.requests.length
			yield* Effect.promise(() => writer.provider.connect())
			expect(writer.provider.connected).toBe(false)
			expect(gateway.requests.length).toBe(count)
		}),
	)
})
