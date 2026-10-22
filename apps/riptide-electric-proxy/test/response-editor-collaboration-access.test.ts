import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { describe, it } from '@effect/vitest'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { sessions } from '@humanlayer/db/tables/sessions'
import { responseEditorCollaborationPath } from '@humanlayer/streams/response-editor-collaboration'
import { eq } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { expect } from 'vitest'

import { createElectricTestContext } from './fixtures'
import { startAuthenticatedProxy, startStorageRecorder } from './response-editor-fixtures'

describe('response editor access', () => {
	it.effect('enforces the real database owner/invitee/viewer matrix before storage dispatch', () =>
		Effect.gen(function* () {
			const now = yield* Clock.currentTimeMillis
			const ctx = yield* Effect.acquireRelease(
				Effect.promise(() => createElectricTestContext()),
				(c) => Effect.promise(() => c.shutdown()),
			)
			const recorder = yield* Effect.acquireRelease(
				Effect.promise(() => startStorageRecorder()),
				(r) => Effect.promise(r.stop),
			)
			const proxy = yield* Effect.acquireRelease(
				Effect.promise(() => startAuthenticatedProxy(ctx.db, recorder.origin)),
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
					multiplayer_prompting_started_at: BigInt(now - 1000),
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
			const path = responseEditorCollaborationPath({ organizationId: org, sessionId: session.id })
			const request = async (token: string | null, method: string, suffix = '', route = path) => {
				const response = await fetch(`${proxy.origin}${route}${suffix}`, {
					method,
					headers: token
						? { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }
						: {},
					body: method === 'POST' || method === 'PUT' ? new Uint8Array([1, 2, 3]) : undefined,
				})
				await response.arrayBuffer()
				return response.status
			}
			const owner = yield* Effect.promise(() => proxy.token('owner', org))
			const invitee = yield* Effect.promise(() => proxy.token('invitee', org))
			const viewer = yield* Effect.promise(() => proxy.token('viewer', org))
			const other = yield* Effect.promise(() => proxy.token('owner', randomUUID()))
			const expired = yield* Effect.promise(() => proxy.token('owner', org, '-1s'))
			for (const token of [null, expired, 'invalid'])
				expect(yield* Effect.promise(() => request(token, 'GET'))).toBe(401)
			expect(yield* Effect.promise(() => request(other, 'GET'))).toBe(403)
			const differentPath = responseEditorCollaborationPath({
				organizationId: randomUUID(),
				sessionId: session.id,
			})
			expect(yield* Effect.promise(() => request(owner, 'PUT', '', differentPath))).toBe(403)
			expect(recorder.requests).toHaveLength(0)
			for (const token of [owner, invitee])
				for (const method of ['GET', 'HEAD', 'PUT', 'POST'])
					expect(yield* Effect.promise(() => request(token, method))).toBe(200)
			for (const suffix of ['', '?awareness=default'])
				for (const method of ['GET', 'HEAD'])
					expect(yield* Effect.promise(() => request(viewer, method, suffix))).toBe(200)
			for (const method of ['PUT', 'POST']) {
				expect(yield* Effect.promise(() => request(viewer, method))).toBe(403)
				expect(yield* Effect.promise(() => request(viewer, method, '?awareness=default'))).toBe(200)
			}
			const before = recorder.requests.length
			for (const suffix of [
				'?awareness=',
				'?awareness=other',
				'?awareness=default&awareness=default',
				'?awareness=default&awareness=',
				'?offset=snapshot',
				'?offset=1_snapshot',
				'?awareness=default&offset=snapshot',
			])
				expect(yield* Effect.promise(() => request(viewer, 'POST', suffix))).toBe(400)
			expect(yield* Effect.promise(() => request(owner, 'DELETE'))).toBe(405)
			for (const suffix of ['/.updates', '/snapshots', '/subscriptions'])
				expect(yield* Effect.promise(() => request(owner, 'POST', suffix))).toBe(404)
			expect(recorder.requests).toHaveLength(before)
			const expiredAt = BigInt((yield* Clock.currentTimeMillis) - 1)
			for (const update of [
				{ multiplayer_prompting_expires_at: expiredAt },
				{ multiplayer_prompting_expires_at: null, multiplayer_prompting_user_ids: [] },
			]) {
				yield* Effect.promise(() => ctx.db.update(sessions).set(update).where(eq(sessions.id, session.id)))
				expect(yield* Effect.promise(() => request(invitee, 'POST'))).toBe(403)
				expect(yield* Effect.promise(() => request(invitee, 'GET'))).toBe(200)
				expect(yield* Effect.promise(() => request(invitee, 'POST', '?awareness=default'))).toBe(200)
			}
			expect(
				recorder.requests.every((r) => r.path.startsWith('/durable-streams/v1/stream/yjs/response-editor/')),
			).toBe(true)
			for (const req of recorder.requests.filter((r) => r.method === 'PUT'))
				expect(req.headers.get('stream-ttl')).toBe('3600')
			for (const req of recorder.requests) expect(req.headers.get('authorization')).toBeNull()
		}),
	)
})
