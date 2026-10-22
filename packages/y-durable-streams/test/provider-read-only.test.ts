import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { awaitSynced, awaitText, createProvider, startGateway } from './fixtures'

describe('read-only provider', () => {
	it.live('waits for a writer, reads updates and publishes presence without any document writes', () =>
		Effect.gen(function* () {
			const gateway = yield* Effect.acquireRelease(Effect.promise(startGateway), (g) => Effect.promise(g.stop))
			const id = randomUUID()
			let token = 'viewer-first'
			const viewer = yield* Effect.acquireRelease(
				Effect.sync(() =>
					createProvider(gateway.baseUrl, id, {
						contentAccess: 'read-only',
						headers: { Authorization: async () => token },
					}),
				),
				(p) => Effect.promise(p.stop),
			)
			yield* Effect.promise(() => viewer.provider.connect())
			yield* Effect.promise(() => viewer.provider.flush())
			const missing = yield* Effect.promise(() =>
				fetch(`${gateway.storage.url}/v1/stream/yjs/tests/docs/${id}/.updates`, { method: 'HEAD' }),
			)
			expect(missing.status).toBe(404)
			token = 'viewer-refreshed'
			viewer.awareness.setLocalStateField('user', { memberId: 'viewer' })
			yield* Effect.promise(() => viewer.provider.flush())
			const writer = yield* Effect.acquireRelease(
				Effect.sync(() => createProvider(gateway.baseUrl, id)),
				(p) => Effect.promise(p.stop),
			)
			yield* Effect.promise(() => writer.provider.connect())
			yield* Effect.all([awaitSynced(writer.provider), awaitSynced(viewer.provider)], { concurrency: 2 })
			writer.doc.getText('text').insert(0, 'shared')
			yield* Effect.promise(() => writer.provider.flush())
			yield* awaitText(viewer.doc, 'shared')
			viewer.doc.getText('text').insert(0, 'must remain local')
			yield* Effect.promise(viewer.stop)
			const requests = gateway.requests.filter((r) => r.authorization?.startsWith('viewer'))
			expect(requests.some((r) => r.authorization === 'viewer-refreshed')).toBe(true)
			expect(requests.some((r) => r.method === 'POST' && r.url.searchParams.get('awareness') === 'default')).toBe(
				true,
			)
			expect(
				requests.filter((r) => ['POST', 'PUT'].includes(r.method) && !r.url.searchParams.has('awareness')),
			).toEqual([])
			expect(writer.doc.getText('text').toString()).toBe('shared')
		}),
	)
})
