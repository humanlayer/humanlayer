import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'
import * as Y from 'yjs'

import {
	createSharedResponseOwner,
	isSharedResponseEligible,
	type SharedResponseOptions,
} from '@/hooks/session-detail/use-response-editor-collaboration'
import { useDraftsStore } from '@/hooks/stores/draftsStore'
import { readRetainedResponse, retainSharedResponse } from '@/hooks/stores/shared-response-retention-store'

import { awaitSynced, awaitText, startGatewayWithOptions } from '../../../../packages/y-durable-streams/test/fixtures'

describe('shared response owner', () => {
	it.effect('owns real providers, retains causal state, and keeps viewers content-read-only', () =>
		Effect.gen(function* () {
			const gateway = yield* Effect.acquireRelease(
				Effect.promise(() =>
					startGatewayWithOptions({
						translateRequest: async (request) => {
							const url = new URL(request.url)
							url.pathname = `/v1/yjs/response-editor/docs${url.pathname}`
							return new Request(url, {
								method: request.method,
								headers: request.headers,
								signal: request.signal,
								body: ['PUT', 'POST'].includes(request.method)
									? await request.arrayBuffer()
									: undefined,
							})
						},
					}),
				),
				(value) => Effect.promise(value.stop),
			)
			const options: SharedResponseOptions = {
				organizationId: 'org',
				sessionId: 'session',
				memberId: 'writer',
				contentAccess: 'read-write',
				getAccessToken: async () => 'writer',
				syncOrigin: new URL(gateway.baseUrl).origin,
			}
			useDraftsStore.getState().setDraft('session', 'private')
			const writer = yield* Effect.acquireRelease(
				Effect.sync(() => createSharedResponseOwner(options)),
				(owner) => Effect.sync(owner.destroy),
			)
			yield* awaitSynced(writer.provider)
			expect(writer.getSnapshot().status).toBe('connected')
			expect(writer.binding.document.getXmlFragment('response').length).toBe(0)
			const viewer = yield* Effect.acquireRelease(
				Effect.sync(() =>
					createSharedResponseOwner({
						...options,
						memberId: 'viewer',
						contentAccess: 'read-only',
						getAccessToken: async () => 'viewer',
					}),
				),
				(owner) => Effect.sync(owner.destroy),
			)
			yield* awaitSynced(viewer.provider)
			expect(viewer.getSnapshot().status).toBe('view-only')
			writer.binding.document.getText('text').insert(0, 'shared')
			yield* Effect.promise(() => writer.provider.flush())
			yield* awaitText(viewer.binding.document, 'shared')
			writer.binding.document.getText('text').delete(0, 6)
			yield* Effect.promise(() => writer.provider.flush())
			yield* awaitText(viewer.binding.document, '')
			yield* Effect.promise(() => viewer.provider.flush())
			const state = readRetainedResponse(options)
			expect(state).toBeDefined()
			const restored = new Y.Doc()
			if (state) Y.applyUpdate(restored, state)
			expect(restored.getText('text').toString()).toBe('')
			expect(Y.encodeStateVector(restored)).toEqual(Y.encodeStateVector(writer.binding.document))
			restored.destroy()
			writer.destroy()
			viewer.destroy()
			expect(writer.binding.document.isDestroyed).toBe(true)
			expect(viewer.binding.awareness.getLocalState()).toBeNull()
			expect(writer.provider.connected).toBe(false)
			expect(useDraftsStore.getState().drafts.session).toBe('private')
			const viewerRequests = gateway.requests.filter((request) => request.authorization === 'Bearer viewer')
			expect(
				viewerRequests.some(
					(request) => request.method === 'POST' && request.url.searchParams.has('awareness'),
				),
			).toBe(true)
			expect(
				viewerRequests.filter(
					(request) => ['PUT', 'POST'].includes(request.method) && !request.url.searchParams.has('awareness'),
				),
			).toEqual([])
		}),
	)

	it('retains deletion identities when an older tab saves later; isolates organization/session keys', () => {
		const key = { organizationId: 'one', sessionId: 'session' }
		const doc = new Y.Doc()
		const older = new Y.Doc()
		const restored = new Y.Doc()
		try {
			doc.getText('text').insert(0, 'deleted')
			Y.applyUpdate(older, Y.encodeStateAsUpdate(doc))
			doc.getText('text').delete(0, 7)
			retainSharedResponse(key, doc)
			retainSharedResponse(key, older)
			const retained = readRetainedResponse(key)
			if (!retained) throw new Error('Missing retained state')
			Y.applyUpdate(restored, retained)
			expect(restored.getText('text').toString()).toBe('')
			expect(readRetainedResponse({ ...key, organizationId: 'two' })).toBeUndefined()
			expect(readRetainedResponse({ ...key, sessionId: 'other' })).toBeUndefined()
		} finally {
			doc.destroy()
			older.destroy()
			restored.destroy()
		}
	})

	it('activates for an eligible active multiplayer session without a rollout assignment', () => {
		expect(
			isSharedResponseEligible({
				existingDesktopSession: true,
				sharingActive: true,
				organizationFeatureEnabled: true,
				sameOrganization: true,
			}),
		).toBe(true)
	})

	it.each([
		['solo', { sharingActive: false }],
		['inactive sharing', { sharingActive: false }],
		['mobile', { existingDesktopSession: false }],
		['new session', { existingDesktopSession: false }],
		['organization disabled', { organizationFeatureEnabled: false }],
		['cross organization', { sameOrganization: false }],
	])('does not activate for %s', (_label, overrides) => {
		expect(
			isSharedResponseEligible({
				existingDesktopSession: true,
				sharingActive: true,
				organizationFeatureEnabled: true,
				sameOrganization: true,
				...overrides,
			}),
		).toBe(false)
	})
})
