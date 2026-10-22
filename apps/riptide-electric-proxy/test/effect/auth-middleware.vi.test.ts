import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import type { AppConfig, SimpleAuthContext } from '../../src/app-config'
import { createAuthMiddleware } from '../../src/middleware'

function makeConfig(): AppConfig {
	return {
		electricShapeUrl: 'http://electric.test/v1/shape',
		// Unused here: these tests never send a Bearer header, so the JWT validator is never called.
		effectRuntime: {} as never,
		db: {} as never,
		validateDaemonToken: async () => ({ organizationId: 'org-1', userId: 'user-1', hostId: 'host-1' }),
	} as unknown as AppConfig
}

describe('createAuthMiddleware', () => {
	it('authorizes a valid daemon token and runs the downstream handler with the auth context', async () => {
		const app = new Hono<{ Variables: { authContext: SimpleAuthContext } }>()
		app.use(createAuthMiddleware(makeConfig()))
		app.get('/whoami', (c) => c.json(c.var.authContext))

		const res = await app.request('/whoami', { headers: { 'x-daemon-authorization': 'tok' } })

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ organizationId: 'org-1', userId: 'user-1', hostId: 'host-1' })
	})

	it('returns 401 when no credentials are supplied', async () => {
		const app = new Hono()
		app.use(createAuthMiddleware(makeConfig()))
		app.get('/whoami', (c) => c.text('ok'))

		const res = await app.request('/whoami')

		expect(res.status).toBe(401)
	})

	it('does not swallow a rejected next() as an auth_failure 401 — it lets the error propagate', async () => {
		// In production the downstream error is a Response-finalization throw that surfaces as a
		// rejection of the auth middleware's `next()`. We reproduce that condition directly here
		// (Hono's compose would otherwise route a handler throw to onError, never to this catch).
		const mw = createAuthMiddleware(makeConfig())
		const ctx = {
			req: { header: (name: string) => (name === 'x-daemon-authorization' ? 'tok' : undefined) },
			set: () => {},
			newResponse: (body: string | null, status: number) => new Response(body, { status }),
		}
		const next = () => Promise.reject(new Error('downstream finalization error'))

		// Before the fix the auth `catch` swallowed this into a 401 tagged `auth_failure`;
		// after the fix `next()` is outside the try, so the original error propagates.
		await expect((mw as (c: unknown, n: unknown) => Promise<unknown>)(ctx, next)).rejects.toThrow(
			'downstream finalization error',
		)
	})
})
