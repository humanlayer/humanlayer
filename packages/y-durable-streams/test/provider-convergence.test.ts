import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { awaitSynced, awaitText, createProvider, startGateway } from './fixtures'

describe('owned provider', () => {
	it.effect('concurrently creates, merges edits, replays and leaves the stream open after teardown', () =>
		Effect.gen(function* () {
			const gateway = yield* Effect.acquireRelease(Effect.promise(startGateway), (g) => Effect.promise(g.stop))
			const id = randomUUID()
			const a = yield* Effect.acquireRelease(
				Effect.sync(() => createProvider(gateway.baseUrl, id)),
				(p) => Effect.promise(p.stop),
			)
			const b = yield* Effect.acquireRelease(
				Effect.sync(() => createProvider(gateway.baseUrl, id)),
				(p) => Effect.promise(p.stop),
			)
			yield* Effect.promise(() => Promise.all([a.provider.connect(), b.provider.connect()]))
			yield* Effect.all([awaitSynced(a.provider), awaitSynced(b.provider)], { concurrency: 2 })
			a.doc.getText('text').insert(0, 'A')
			b.doc.getText('text').insert(0, 'B')
			yield* Effect.promise(() => Promise.all([a.provider.flush(), b.provider.flush()]))
			// Yjs orders simultaneous insertions by client ID, not wall-clock timing.
			const expected = a.doc.clientID < b.doc.clientID ? 'AB' : 'BA'
			yield* Effect.all([awaitText(a.doc, expected), awaitText(b.doc, expected)], { concurrency: 2 })
			yield* Effect.promise(a.stop)
			b.doc.getText('text').insert(2, '!')
			yield* Effect.promise(() => b.provider.flush())
			const late = yield* Effect.acquireRelease(
				Effect.sync(() => createProvider(gateway.baseUrl, id)),
				(p) => Effect.promise(p.stop),
			)
			yield* Effect.promise(() => late.provider.connect())
			yield* awaitSynced(late.provider)
			expect(late.doc.getText('text').toString()).toBe(`${expected}!`)
			expect(gateway.requests.some((r) => r.url.searchParams.get('offset') === 'snapshot')).toBe(false)
		}),
	)
})
