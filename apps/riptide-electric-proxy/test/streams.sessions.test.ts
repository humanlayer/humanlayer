import { createServer, type Server } from 'node:http'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { AppConfig, SimpleAuthContext } from '../src/app-config'
import { createTestAppRuntime } from '../src/lib/effect/runtime'
import { createStreamsApp } from '../src/routes/streams'

const organizationId = '019f49dc-5942-7ca0-a95b-4e2f953f6f36'
const sessionId = '019f49dc-71fd-7352-99e7-796e280d1bd8'
const userId = 'user-session-stream'

const sessionRows = [
	{
		createdBy: userId,
		resourceOwnerUserId: userId,
		taskId: null,
		userIds: [],
		startedAt: null,
		expiresAt: null,
		featureEnabled: false,
	},
]

const sessionQuery = {
	from: () => sessionQuery,
	leftJoin: () => sessionQuery,
	where: () => sessionQuery,
	limit: () => Promise.resolve(sessionRows),
}

const db = { select: () => sessionQuery } as unknown as AppConfig['db']

describe('session stream route', () => {
	let upstream: Server
	let upstreamOrigin: string
	let upstreamRequests: { method: string; url: string; body: string }[] = []

	beforeAll(async () => {
		upstream = createServer((request, response) => {
			const chunks: Buffer[] = []
			request.on('data', (chunk: Buffer) => chunks.push(chunk))
			request.on('end', () => {
				upstreamRequests.push({
					method: request.method ?? 'GET',
					url: request.url ?? '',
					body: Buffer.concat(chunks).toString('utf8'),
				})
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
	})

	function makeApp(authContext: SimpleAuthContext) {
		upstreamRequests = []
		const effectRuntime = createTestAppRuntime({
			electricShapeUrl: 'http://electric.invalid',
			durableStreamsOrigin: upstreamOrigin,
		})
		const config: AppConfig = {
			electricShapeUrl: 'http://electric.invalid',
			durableStreamsOrigin: upstreamOrigin,
			testAuthContext: authContext,
			effectRuntime,
			db,
		}
		const app = createStreamsApp(config, { taskDiffs: false, prStatus: false })
		return { app, dispose: () => effectRuntime.dispose() }
	}

	it('proxies browser reads with the query string', async () => {
		const { app, dispose } = makeApp({ organizationId, userId })
		try {
			const response = await app.request(`/sessions/${sessionId}?live=sse&offset=42`)
			expect(response.status).toBe(200)
			expect(upstreamRequests).toEqual([
				{ method: 'GET', url: `/v1/stream/sessions/${sessionId}?live=sse&offset=42`, body: '' },
			])
		} finally {
			await dispose()
		}
	})

	it.each(['POST', 'PUT', 'DELETE'])('rejects a browser %s without reaching upstream', async (method) => {
		const { app, dispose } = makeApp({ organizationId, userId })
		try {
			const response = await app.request(`/sessions/${sessionId}`, { method, body: '{"event":"browser"}' })
			expect(response.status).toBe(403)
			expect(upstreamRequests).toEqual([])
		} finally {
			await dispose()
		}
	})

	it('proxies daemon writes', async () => {
		const { app, dispose } = makeApp({ organizationId, userId, hostId: 'host-session-stream' })
		try {
			const response = await app.request(`/sessions/${sessionId}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"event":"daemon"}',
			})
			expect(response.status).toBe(200)
			expect(upstreamRequests).toEqual([
				{ method: 'POST', url: `/v1/stream/sessions/${sessionId}`, body: '{"event":"daemon"}' },
			])
		} finally {
			await dispose()
		}
	})
})
