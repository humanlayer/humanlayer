import { createServer, type Server } from 'node:http'

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { AppConfig, SimpleAuthContext } from '../src/app-config'
import { createTestAppRuntime } from '../src/lib/effect/runtime'
import { createStreamsApp } from '../src/routes/streams'

const organizationId = '019f49dc-5942-7ca0-a95b-4e2f953f6f36'
const taskId = '019f49dc-71fd-7352-99e7-796e280d1bd8'
const userId = 'user-phase-11'

describe('task diff file-versions stream route', () => {
	let upstream: Server
	let upstreamOrigin: string
	let lastUpstreamRequest: { method: string; url: string; body: string } | undefined
	const sql = postgres('postgres://unused:unused@127.0.0.1:1/unused', { connect_timeout: 1, max: 1 })
	const db = drizzle(sql)

	beforeAll(async () => {
		upstream = createServer((request, response) => {
			const chunks: Buffer[] = []
			request.on('data', (chunk: Buffer) => chunks.push(chunk))
			request.on('end', () => {
				lastUpstreamRequest = {
					method: request.method ?? 'GET',
					url: request.url ?? '',
					body: Buffer.concat(chunks).toString('utf8'),
				}
				response.writeHead(200, { 'content-type': 'application/json' })
				response.end('{"ok":true}')
			})
		})
		await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
		const address = upstream.address()
		if (!address || typeof address === 'string') throw new Error('Expected upstream TCP address')
		upstreamOrigin = `http://127.0.0.1:${address.port}`
	})

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())))
		await sql.end()
	})

	function makeApp(authContext: SimpleAuthContext, _canRead: boolean, origin = upstreamOrigin) {
		const effectRuntime = createTestAppRuntime({
			electricShapeUrl: 'http://electric.invalid',
			durableStreamsOrigin: origin,
		})
		const config: AppConfig = {
			electricShapeUrl: 'http://electric.invalid',
			durableStreamsOrigin: origin,
			testAuthContext: authContext,
			effectRuntime,
			db,
		}
		const app = createStreamsApp(config, { sessions: false })
		return { app, dispose: () => effectRuntime.dispose() }
	}

	it('authorizes reads and preserves the query string in the upstream rewrite', async () => {
		const { app, dispose } = makeApp({ organizationId, userId }, true)
		try {
			const response = await app.request(
				`/organizations/${organizationId}/tasks/${taskId}/diff-file-versions?live=sse&offset=42`,
			)
			expect(response.status).toBe(200)
			expect(lastUpstreamRequest).toEqual({
				method: 'GET',
				url: `/v1/stream/organizations/${organizationId}/tasks/${taskId}/diff-file-versions?live=sse&offset=42`,
				body: '',
			})
		} finally {
			await dispose()
		}
	})

	it('authorizes organization members and rejects cross-organization reads', async () => {
		const unauthorized = makeApp({ organizationId, userId }, false)
		try {
			expect(
				(await unauthorized.app.request(`/organizations/${organizationId}/tasks/${taskId}/diff-file-versions`))
					.status,
			).toBe(200)
		} finally {
			await unauthorized.dispose()
		}

		const wrongOrganization = makeApp({ organizationId: '019f49dc-5942-7ca0-a95b-4e2f953f6f37', userId }, true)
		try {
			expect(
				(
					await wrongOrganization.app.request(
						`/organizations/${organizationId}/tasks/${taskId}/diff-file-versions`,
					)
				).status,
			).toBe(403)
		} finally {
			await wrongOrganization.dispose()
		}
	})

	it.each([
		[`/organizations/not-a-uuid/tasks/${taskId}/diff-file-versions`],
		[`/organizations/${organizationId}/tasks/not-a-uuid/diff-file-versions`],
	])('returns 400 for invalid identifiers in %s', async (path) => {
		const { app, dispose } = makeApp({ organizationId, userId }, true)
		try {
			expect((await app.request(path)).status).toBe(400)
		} finally {
			await dispose()
		}
	})

	it('allows daemon writes and rejects browser writes', async () => {
		const browser = makeApp({ organizationId, userId }, true)
		try {
			expect(
				(
					await browser.app.request(`/organizations/${organizationId}/tasks/${taskId}/diff-file-versions`, {
						method: 'POST',
						body: '{"event":"browser"}',
					})
				).status,
			).toBe(403)
		} finally {
			await browser.dispose()
		}

		const daemon = makeApp({ organizationId, userId, hostId: 'host-phase-11' }, true)
		try {
			const response = await daemon.app.request(
				`/organizations/${organizationId}/tasks/${taskId}/diff-file-versions`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: '{"event":"daemon"}',
				},
			)
			expect(response.status).toBe(200)
			expect(lastUpstreamRequest).toMatchObject({ method: 'POST', body: '{"event":"daemon"}' })
		} finally {
			await daemon.dispose()
		}
	})

	it('forwards an empty daemon PUT used to create a stream', async () => {
		const daemon = makeApp({ organizationId, userId, hostId: 'host-phase-11' }, true)
		try {
			const response = await daemon.app.request(
				`/organizations/${organizationId}/tasks/${taskId}/diff-file-versions`,
				{
					method: 'PUT',
				},
			)
			expect(response.status).toBe(200)
			expect(lastUpstreamRequest).toEqual({
				method: 'PUT',
				body: '',
				url: `/v1/stream/organizations/${organizationId}/tasks/${taskId}/diff-file-versions`,
			})
		} finally {
			await daemon.dispose()
		}
	})

	it('maps upstream connection failure to 502', async () => {
		const { app, dispose } = makeApp({ organizationId, userId }, true, 'http://127.0.0.1:1')
		try {
			const response = await app.request(`/organizations/${organizationId}/tasks/${taskId}/diff-file-versions`)
			expect(response.status).toBe(502)
			expect(await response.json()).toEqual({ error: 'Unable to connect to Durable Streams server' })
		} finally {
			await dispose()
		}
	})
})
