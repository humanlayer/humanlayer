import { createServer, type Server } from 'node:http'

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { AppConfig, SimpleAuthContext } from '../src/app-config'
import { createTestAppRuntime } from '../src/lib/effect/runtime'
import { createStreamsApp } from '../src/routes/streams'

const organizationId = '019f49dc-5942-7ca0-a95b-4e2f953f6f36'
const userId = 'user-pr-status'
const repoFullName = 'humanlayer/syncopate'
const branch = 'feat/pr-status-checks'
const encodedRepo = encodeURIComponent(repoFullName)
const encodedBranch = encodeURIComponent(branch)
const routeFor = (repo = encodedRepo, ref = encodedBranch) =>
	`/organizations/${organizationId}/github/repos/${repo}/branches/${ref}/pr-status`

describe('PR status stream route', () => {
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

	function makeApp(authContext: SimpleAuthContext, origin = upstreamOrigin) {
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
		return { app: createStreamsApp(config, { sessions: false }), dispose: () => effectRuntime.dispose() }
	}

	it('round-trips repo and branch segments that contain a slash, and preserves the query string', async () => {
		const { app, dispose } = makeApp({ organizationId, userId })
		try {
			const response = await app.request(`${routeFor()}?live=sse&offset=42`)
			expect(response.status).toBe(200)
			expect(lastUpstreamRequest).toEqual({
				method: 'GET',
				url:
					`/v1/stream/organizations/${organizationId}` +
					`/github/repos/${encodedRepo}/branches/${encodedBranch}/pr-status?live=sse&offset=42`,
				body: '',
			})
		} finally {
			await dispose()
		}
	})

	it('authorizes by organization membership with no database access', async () => {
		const { app, dispose } = makeApp({ organizationId, userId })
		try {
			expect((await app.request(routeFor())).status).toBe(200)
		} finally {
			await dispose()
		}
	})

	it('returns 400 for a malformed organization id', async () => {
		const { app, dispose } = makeApp({ organizationId, userId })
		try {
			const response = await app.request(
				`/organizations/not-a-uuid/github/repos/${encodedRepo}/branches/${encodedBranch}/pr-status`,
			)
			expect(response.status).toBe(400)
		} finally {
			await dispose()
		}
	})

	it('returns 403 for another organization', async () => {
		const { app, dispose } = makeApp({ organizationId: '019f49dc-71fd-7352-99e7-796e280d1bd8', userId })
		try {
			expect((await app.request(routeFor())).status).toBe(403)
		} finally {
			await dispose()
		}
	})

	it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses %s from a browser token', async (method) => {
		const { app, dispose } = makeApp({ organizationId, userId })
		try {
			expect((await app.request(routeFor(), { method })).status).toBe(403)
		} finally {
			await dispose()
		}
	})

	it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses %s from a daemon token', async (method) => {
		const { app, dispose } = makeApp({ organizationId, userId, hostId: 'host-pr-status' })
		try {
			expect((await app.request(routeFor(), { method })).status).toBe(403)
		} finally {
			await dispose()
		}
	})

	it('maps an unreachable upstream to 502 rather than an auth response', async () => {
		const { app, dispose } = makeApp({ organizationId, userId }, 'http://127.0.0.1:1')
		try {
			const response = await app.request(routeFor())
			expect(response.status).toBe(502)
			expect(await response.json()).toEqual({ error: 'Unable to connect to Durable Streams server' })
		} finally {
			await dispose()
		}
	})
})
