import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { describe, it } from '@effect/vitest'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { sessions } from '@humanlayer/db/tables/sessions'
import {
	RESPONSE_EDITOR_DOCUMENT_ID,
	responseEditorCollaborationBasePath,
} from '@humanlayer/streams/response-editor-collaboration'
import { eq } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { expect } from 'vitest'
import * as Y from 'yjs'

import { awaitSynced, awaitText, createProvider } from '../../../packages/y-durable-streams/test/fixtures'
import { createElectricTestContext } from './fixtures'
import { durableStreamsOrigin, startAuthenticatedProxy } from './response-editor-fixtures'

describe('response editor through authenticated proxy into Durable Streams', () => {
	it.live('restores retained deletions and concurrent state, then observes revoked prompt and auth access', () =>
		Effect.gen(function* () {
			const now = yield* Clock.currentTimeMillis
			const ctx = yield* Effect.acquireRelease(
				Effect.promise(() => createElectricTestContext()),
				(c) => Effect.promise(() => c.shutdown()),
			)
			const proxy = yield* Effect.acquireRelease(
				Effect.promise(() => startAuthenticatedProxy(ctx.db, durableStreamsOrigin)),
				(p) => Effect.promise(p.stop),
			)
			const org = ctx.defaultOrganization.id
			const session = yield* Effect.promise(() =>
				ctx.seedSession({
					organization_id: org,
					resource_owner_user_id: 'owner',
					created_by: 'owner',
					working_directory: tmpdir(),
					host_id: randomUUID(),
					status: 'ready_for_input',
					multiplayer_prompting_user_ids: ['invitee'],
					multiplayer_prompting_started_at: BigInt(now - 1_000),
					multiplayer_prompting_expires_at: null,
				}),
			)
			yield* Effect.promise(() =>
				ctx.db
					.insert(organizationSettings)
					.values({ organization_id: org, multiplayer_prompting_enabled: true })
					.onConflictDoUpdate({
						target: organizationSettings.organization_id,
						set: { multiplayer_prompting_enabled: true },
					}),
			)
			const baseUrl = `${proxy.origin}${responseEditorCollaborationBasePath({ organizationId: org, sessionId: session.id })}`
			const ownerToken = yield* Effect.promise(() => proxy.token('owner', org))
			const inviteeToken = yield* Effect.promise(() => proxy.token('invitee', org))
			const a = yield* Effect.acquireRelease(
				Effect.sync(() =>
					createProvider(baseUrl, RESPONSE_EDITOR_DOCUMENT_ID, {
						headers: { Authorization: `Bearer ${ownerToken}` },
					}),
				),
				(p) => Effect.promise(p.stop),
			)
			a.doc.getText('text').insert(0, 'deleted')
			yield* Effect.promise(() => a.provider.connect())
			yield* awaitSynced(a.provider)
			const retained = Y.encodeStateAsUpdate(a.doc)
			yield* Effect.promise(() => a.provider.disconnect())
			a.doc.getText('text').delete(0, 7)
			const streamUrl = `${durableStreamsOrigin}/v1/stream/yjs/response-editor/docs/${org}/${session.id}/response-v1/.updates`
			const deleted = yield* Effect.promise(() => fetch(streamUrl, { method: 'DELETE' }))
			expect(deleted.status).toBe(204)
			let token = inviteeToken
			const b = yield* Effect.acquireRelease(
				Effect.sync(() =>
					createProvider(baseUrl, RESPONSE_EDITOR_DOCUMENT_ID, {
						retainedState: retained,
						headers: { Authorization: () => `Bearer ${token}` },
					}),
				),
				(p) => Effect.promise(p.stop),
			)
			b.doc.getText('other').insert(0, 'concurrent')
			yield* Effect.promise(() => Promise.all([a.provider.connect(), b.provider.connect()]))
			yield* Effect.all([awaitSynced(a.provider), awaitSynced(b.provider)], { concurrency: 2 })
			yield* awaitText(b.doc, '')
			const viewerToken = yield* Effect.promise(() => proxy.token('viewer', org))
			const fresh = yield* Effect.acquireRelease(
				Effect.sync(() =>
					createProvider(baseUrl, RESPONSE_EDITOR_DOCUMENT_ID, {
						contentAccess: 'read-only',
						headers: { Authorization: `Bearer ${viewerToken}` },
					}),
				),
				(p) => Effect.promise(p.stop),
			)
			yield* Effect.promise(() => fresh.provider.connect())
			yield* awaitSynced(fresh.provider)
			expect(fresh.doc.getText('text').toString()).toBe('')
			expect(fresh.doc.getText('other').toString()).toBe('concurrent')
			// Current DB capability is authoritative, even before the UI observes it.
			yield* Effect.promise(() =>
				ctx.db.update(sessions).set({ multiplayer_prompting_user_ids: [] }).where(eq(sessions.id, session.id)),
			)
			const downgraded = Promise.withResolvers<void>()
			b.provider.on('access', (access) => {
				if (access === 'read-only') downgraded.resolve()
			})
			b.doc.getText('text').insert(0, 'denied')
			yield* Effect.promise(() => b.provider.flush())
			yield* Effect.promise(() => downgraded.promise)
			yield* awaitSynced(b.provider)
			const writesBefore = proxy.requests.filter(
				(r) =>
					r.token === `Bearer ${inviteeToken}` && r.method === 'POST' && !r.url.searchParams.has('awareness'),
			).length
			b.doc.getText('text').insert(0, 'also denied')
			yield* Effect.promise(() => b.provider.flush())
			expect(
				proxy.requests.filter(
					(r) =>
						r.token === `Bearer ${inviteeToken}` &&
						r.method === 'POST' &&
						!r.url.searchParams.has('awareness'),
				),
			).toHaveLength(writesBefore)
			expect(fresh.doc.getText('text').toString()).toBe('')
			const lost = Promise.withResolvers<void>()
			b.provider.on('access', (access) => {
				if (access === 'access-lost') lost.resolve()
			})
			token = 'invalid-test-token'
			b.awareness.setLocalStateField('user', { memberId: 'invitee' })
			yield* Effect.promise(() => b.provider.flush())
			yield* Effect.promise(() => lost.promise)
			expect(b.provider.connected).toBe(false)
			const invalidRequestsBeforeReconnect = proxy.requests.filter(
				(r) => r.token === 'Bearer invalid-test-token',
			).length
			expect(invalidRequestsBeforeReconnect).toBeGreaterThan(0)
			yield* Effect.promise(() => b.provider.connect())
			expect(proxy.requests.filter((r) => r.token === 'Bearer invalid-test-token')).toHaveLength(
				invalidRequestsBeforeReconnect,
			)
			expect(
				proxy.requests.filter(
					(r) =>
						r.token === `Bearer ${viewerToken}` &&
						['PUT', 'POST'].includes(r.method) &&
						!r.url.searchParams.has('awareness'),
				),
			).toEqual([])
		}),
	)
	it.live('converges two writers and a viewer, refreshes credentials and keeps streams open on departure', () =>
		Effect.gen(function* () {
			const now = yield* Clock.currentTimeMillis
			const ctx = yield* Effect.acquireRelease(
				Effect.promise(() => createElectricTestContext()),
				(c) => Effect.promise(() => c.shutdown()),
			)
			const proxy = yield* Effect.acquireRelease(
				Effect.promise(() => startAuthenticatedProxy(ctx.db, durableStreamsOrigin)),
				(p) => Effect.promise(p.stop),
			)
			const org = ctx.defaultOrganization.id
			const session = yield* Effect.promise(() =>
				ctx.seedSession({
					organization_id: org,
					resource_owner_user_id: 'owner',
					created_by: 'owner',
					working_directory: tmpdir(),
					host_id: randomUUID(),
					status: 'ready_for_input',
					multiplayer_prompting_user_ids: ['invitee'],
					multiplayer_prompting_started_at: BigInt(now - 1_000),
					multiplayer_prompting_expires_at: null,
				}),
			)
			yield* Effect.promise(() =>
				ctx.db
					.insert(organizationSettings)
					.values({ organization_id: org, multiplayer_prompting_enabled: true })
					.onConflictDoUpdate({
						target: organizationSettings.organization_id,
						set: { multiplayer_prompting_enabled: true },
					}),
			)
			const baseUrl = `${proxy.origin}${responseEditorCollaborationBasePath({ organizationId: org, sessionId: session.id })}`
			const ownerToken = yield* Effect.promise(() => proxy.token('owner', org))
			const inviteeToken = yield* Effect.promise(() => proxy.token('invitee', org))
			const viewerToken = yield* Effect.promise(() => proxy.token('viewer', org))
			let token = ownerToken
			const a = yield* Effect.acquireRelease(
				Effect.sync(() =>
					createProvider(baseUrl, RESPONSE_EDITOR_DOCUMENT_ID, {
						headers: { Authorization: async () => `Bearer ${token}` },
					}),
				),
				(p) => Effect.promise(p.stop),
			)
			const b = yield* Effect.acquireRelease(
				Effect.sync(() =>
					createProvider(baseUrl, RESPONSE_EDITOR_DOCUMENT_ID, {
						headers: { Authorization: `Bearer ${inviteeToken}` },
					}),
				),
				(p) => Effect.promise(p.stop),
			)
			const viewer = yield* Effect.acquireRelease(
				Effect.sync(() =>
					createProvider(baseUrl, RESPONSE_EDITOR_DOCUMENT_ID, {
						contentAccess: 'read-only',
						headers: { Authorization: `Bearer ${viewerToken}` },
					}),
				),
				(p) => Effect.promise(p.stop),
			)
			yield* Effect.promise(() => a.provider.connect())
			yield* awaitSynced(a.provider)
			yield* Effect.promise(() => Promise.all([b.provider.connect(), viewer.provider.connect()]))
			yield* Effect.all([awaitSynced(b.provider), awaitSynced(viewer.provider)], {
				concurrency: 3,
			})
			token = yield* Effect.promise(() => proxy.token('owner', org, '2h'))
			a.doc.getText('text').insert(0, 'A')
			b.doc.getText('text').insert(0, 'B')
			yield* Effect.promise(() => Promise.all([a.provider.flush(), b.provider.flush(), viewer.provider.flush()]))
			const expected = a.doc.clientID < b.doc.clientID ? 'AB' : 'BA'
			yield* Effect.all(
				[awaitText(a.doc, expected), awaitText(b.doc, expected), awaitText(viewer.doc, expected)],
				{ concurrency: 3 },
			)
			yield* Effect.promise(a.stop)
			b.doc.getText('text').insert(2, '!')
			yield* Effect.promise(() => b.provider.flush())
			yield* awaitText(viewer.doc, `${expected}!`)
			yield* Effect.promise(viewer.stop)
			const viewerRequests = proxy.requests.filter((r) => r.token === `Bearer ${viewerToken}`)
			expect(viewerRequests.some((r) => r.method === 'POST' && r.url.searchParams.has('awareness'))).toBe(true)
			expect(
				viewerRequests.filter(
					(r) => ['PUT', 'POST'].includes(r.method) && !r.url.searchParams.has('awareness'),
				),
			).toEqual([])
			expect(
				proxy.requests.some(
					(r) => r.method === 'POST' && r.token === `Bearer ${token}` && !r.url.searchParams.has('awareness'),
				),
			).toBe(true)
			const streamUrl = `${durableStreamsOrigin}/v1/stream/yjs/response-editor/docs/${org}/${session.id}/response-v1/.updates`
			const endState = yield* Effect.promise(() => fetch(`${streamUrl}?offset=-1`))
			expect(endState.status).toBe(200)
			expect((yield* Effect.promise(() => endState.arrayBuffer())).byteLength).toBeGreaterThan(0)
		}),
	)
})
