import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'
import type { Awareness } from 'y-protocols/awareness'

import { createProvider, startGateway, awaitSynced, awaitText } from './fixtures'

function awaitPresence(awareness: Awareness, clientId: number, present: boolean) {
	return Effect.callback<void>((resume) => {
		const changed = () => {
			if (awareness.getStates().has(clientId) === present) resume(Effect.void)
		}
		awareness.on('change', changed)
		changed()
		return Effect.sync(() => awareness.off('change', changed))
	})
}

it.live(
	'announces awareness readiness independently, sends departure without closing the document, and preserves peers',
	() =>
		Effect.gen(function* () {
			const gateway = yield* Effect.acquireRelease(Effect.promise(startGateway), (g) => Effect.promise(g.stop))
			const viewer = yield* Effect.acquireRelease(
				Effect.sync(() =>
					createProvider(gateway.baseUrl, 'presence', {
						contentAccess: 'read-only',
						headers: { Authorization: 'viewer' },
					}),
				),
				(p) => Effect.promise(p.stop),
			)
			const ready = Effect.callback<void>((resume) => {
				const onReady = () => resume(Effect.void)
				viewer.provider.on('awarenessReady', onReady)
				void viewer.provider.connect()
				return Effect.sync(() => viewer.provider.off('awarenessReady', onReady))
			})
			yield* ready
			expect(viewer.provider.synced).toBe(false) // no writer/document yet
			const writer = yield* Effect.acquireRelease(
				Effect.sync(() => createProvider(gateway.baseUrl, 'presence')),
				(p) => Effect.promise(p.stop),
			)
			yield* Effect.promise(() => writer.provider.connect())
			yield* Effect.all([awaitSynced(viewer.provider), awaitSynced(writer.provider)], { concurrency: 2 })
			writer.awareness.setLocalState({ user: { memberId: 'writer' }, session: { present: true }, cursor: null })
			yield* Effect.promise(() => writer.provider.flush())
			yield* awaitPresence(viewer.awareness, writer.awareness.clientID, true)
			writer.provider.destroy()
			expect(writer.provider.connected).toBe(false)
			expect(writer.awareness.getLocalState()).toBeNull()
			yield* awaitPresence(viewer.awareness, writer.awareness.clientID, false)
			const survivor = yield* Effect.acquireRelease(
				Effect.sync(() => createProvider(gateway.baseUrl, 'presence')),
				(p) => Effect.promise(p.stop),
			)
			yield* Effect.promise(() => survivor.provider.connect())
			yield* awaitSynced(survivor.provider)
			survivor.doc.getText('text').insert(0, 'still open')
			yield* Effect.promise(() => survivor.provider.flush())
			yield* awaitText(viewer.doc, 'still open')
			expect(
				gateway.requests.filter(
					(request) =>
						request.authorization === 'viewer' &&
						['PUT', 'POST'].includes(request.method) &&
						!request.url.searchParams.has('awareness'),
				),
			).toEqual([])
		}).pipe(Effect.timeout('10 seconds')),
)
