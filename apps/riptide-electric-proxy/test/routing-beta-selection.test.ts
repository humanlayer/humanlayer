import { createServer } from 'node:http'

import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, test } from 'vitest'

import { JWTValidator } from '../src/auth/effect/jwt-validator.service'
import { makeProxyRuntimeConfig } from '../src/lib/effect/proxy-runtime-config.service'
import { createAppRuntime, makeAppLayer } from '../src/lib/effect/runtime'
import { createApp } from '../src/server'

type CapturedUpstreamRequest = {
	url: URL
}

type UpstreamRecorder = {
	shapeUrl: string
	requests: CapturedUpstreamRequest[]
	stop: () => void
}

const TEST_AUTH_CONTEXT = {
	organizationId: 'org-123',
	userId: 'user-123',
}

const mockDb = {
	select: () => ({
		from: () => ({
			where: () => Promise.resolve([{ id: 'artifact-id' }]),
		}),
	}),
}

const runtimeDisposers: Array<() => Promise<void>> = []

afterEach(async () => {
	await Promise.all(runtimeDisposers.splice(0).map((dispose) => dispose()))
})

async function createUpstreamRecorder(): Promise<UpstreamRecorder> {
	const requests: CapturedUpstreamRequest[] = []
	const server = createServer((req, res) => {
		requests.push({ url: new URL(req.url ?? '/', 'http://127.0.0.1') })
		res.writeHead(200, { 'content-type': 'application/json' })
		res.end('{}')
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	if (!address || typeof address === 'string') {
		throw new Error('Expected upstream recorder to listen on a TCP port')
	}

	return {
		shapeUrl: `http://127.0.0.1:${address.port}/v1/shape`,
		requests,
		stop: () => {
			server.close()
		},
	}
}

function onlyRequest(recorder: UpstreamRecorder): URL {
	expect(recorder.requests.length).toBe(1)
	const request = recorder.requests[0]
	if (!request) {
		throw new Error('Expected exactly one upstream request')
	}
	return request.url
}

function createProxyApp(stableRecorder: UpstreamRecorder, hostId?: string) {
	const effectRuntime = createAppRuntime(
		makeAppLayer({
			proxyRuntimeConfig: makeProxyRuntimeConfig({
				electricShapeUrl: stableRecorder.shapeUrl,
				durableStreamsOrigin: 'http://127.0.0.1:1',
			}),
			authLayer: Layer.succeed(JWTValidator, {
				validateJWT: () => Effect.fail({ _tag: 'UnexpectedJWTValidation' } as any),
			}),
		}),
	)
	runtimeDisposers.push(() => effectRuntime.dispose())
	return createApp({
		electricShapeUrl: stableRecorder.shapeUrl,
		durableStreamsOrigin: 'http://127.0.0.1:1',
		electricSecret: 'stable-secret',
		effectRuntime,
		testAuthContext: {
			...TEST_AUTH_CONTEXT,
			hostId,
		},
		db: mockDb as any,
	})
}

describe('legacy beta query handling', () => {
	test('routes /v1/tasks to stable upstream by default', async () => {
		const stableRecorder = await createUpstreamRecorder()
		const betaRecorder = await createUpstreamRecorder()

		try {
			const app = createProxyApp(stableRecorder)
			const response = await app.request('/v1/tasks?live=true', { method: 'GET' })
			expect(response.status).toBe(200)

			const upstreamUrl = onlyRequest(stableRecorder)
			expect(betaRecorder.requests.length).toBe(0)
			expect(upstreamUrl.pathname).toBe('/v1/shape')
			expect(upstreamUrl.searchParams.get('table')).toBe('tasks')
			expect(upstreamUrl.searchParams.get('where')).toContain('task_user_acl')
			expect(upstreamUrl.searchParams.get('where')).toContain('task_organization_acl')
			expect(upstreamUrl.searchParams.get('live')).toBe('true')
			expect(upstreamUrl.searchParams.get('secret')).toBe('stable-secret')
			expect(upstreamUrl.searchParams.has('beta')).toBe(false)
		} finally {
			stableRecorder.stop()
			betaRecorder.stop()
		}
	})

	test('routes /v1/tasks?beta=1 to stable upstream and does not forward beta param', async () => {
		const stableRecorder = await createUpstreamRecorder()
		const betaRecorder = await createUpstreamRecorder()

		try {
			const app = createProxyApp(stableRecorder)
			const response = await app.request('/v1/tasks?beta=1&live=true&offset=-1', { method: 'GET' })
			expect(response.status).toBe(200)

			const upstreamUrl = onlyRequest(stableRecorder)
			expect(betaRecorder.requests.length).toBe(0)
			expect(upstreamUrl.pathname).toBe('/v1/shape')
			expect(upstreamUrl.searchParams.get('table')).toBe('tasks')
			expect(upstreamUrl.searchParams.get('where')).toContain('task_user_acl')
			expect(upstreamUrl.searchParams.get('where')).toContain('task_organization_acl')
			expect(upstreamUrl.searchParams.get('live')).toBe('true')
			expect(upstreamUrl.searchParams.get('offset')).toBe('-1')
			expect(upstreamUrl.searchParams.get('secret')).toBe('stable-secret')
			expect(upstreamUrl.searchParams.has('beta')).toBe(false)
		} finally {
			stableRecorder.stop()
			betaRecorder.stop()
		}
	})

	test('keeps /v2/tasks?beta=1 on stable upstream and preserves v2 semantics', async () => {
		const stableRecorder = await createUpstreamRecorder()
		const betaRecorder = await createUpstreamRecorder()

		try {
			const app = createProxyApp(stableRecorder)
			const response = await app.request('/v2/tasks?beta=1&live=true', { method: 'GET' })
			expect(response.status).toBe(200)

			const upstreamUrl = onlyRequest(stableRecorder)
			expect(betaRecorder.requests.length).toBe(0)
			expect(upstreamUrl.pathname).toBe('/v1/shape')
			expect(upstreamUrl.searchParams.get('table')).toBe('tasks')
			// WHERE clause should use parameterized placeholder
			expect(upstreamUrl.searchParams.get('where')).toContain('"organization_id"')
			expect(upstreamUrl.searchParams.get('where')).toContain('$1')
			// Value should be passed via params
			expect(upstreamUrl.searchParams.get('params[1]')).toBe('org-123')
			expect(upstreamUrl.searchParams.get('live')).toBe('true')
			expect(upstreamUrl.searchParams.get('secret')).toBe('stable-secret')
			expect(upstreamUrl.searchParams.has('beta')).toBe(false)
		} finally {
			stableRecorder.stop()
			betaRecorder.stop()
		}
	})

	test('routes daemon route with beta query to stable upstream and keeps daemon filtering semantics', async () => {
		const stableRecorder = await createUpstreamRecorder()
		const betaRecorder = await createUpstreamRecorder()

		try {
			const app = createProxyApp(stableRecorder, 'host-123')
			const response = await app.request('/v1/daemon/approvals?beta=1&live=true', { method: 'GET' })
			expect(response.status).toBe(200)

			const upstreamUrl = onlyRequest(stableRecorder)
			expect(betaRecorder.requests.length).toBe(0)
			expect(upstreamUrl.pathname).toBe('/v1/shape')
			expect(upstreamUrl.searchParams.get('table')).toBe('approvals')
			expect(upstreamUrl.searchParams.get('where')).toContain('task_user_acl')
			expect(upstreamUrl.searchParams.get('where')).toContain('task_organization_acl')
			// host_id should be referenced in where clause with a placeholder
			expect(upstreamUrl.searchParams.get('where')).toContain('"host_id"')
			// host_id value should be passed via params (it's one of the later params)
			const paramsValues = Array.from(upstreamUrl.searchParams.entries())
				.filter(([key]) => key.startsWith('params['))
				.map(([, value]) => value)
			expect(paramsValues).toContain('host-123')
			expect(upstreamUrl.searchParams.get('live')).toBe('true')
			expect(upstreamUrl.searchParams.get('secret')).toBe('stable-secret')
			expect(upstreamUrl.searchParams.has('beta')).toBe(false)
		} finally {
			stableRecorder.stop()
			betaRecorder.stop()
		}
	})
})
