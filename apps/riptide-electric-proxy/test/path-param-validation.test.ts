import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, test } from 'vitest'

import { JWTValidator } from '../src/auth/effect/jwt-validator.service'
import { makeProxyRuntimeConfig } from '../src/lib/effect/proxy-runtime-config.service'
import { createAppRuntime, makeAppLayer } from '../src/lib/effect/runtime'
import { createApp } from '../src/server'

const ELECTRIC_SHAPE_URL = 'http://localhost:9999/v1/shape'
const DURABLE_STREAMS_ORIGIN = 'http://127.0.0.1:1'

const TEST_AUTH_CONTEXT = {
	organizationId: 'org-123',
	userId: 'user-123',
}

const runtimeDisposers: Array<() => Promise<void>> = []

afterEach(async () => {
	await Promise.all(runtimeDisposers.splice(0).map((dispose) => dispose()))
})

function createTestApp() {
	const effectRuntime = createAppRuntime(
		makeAppLayer({
			proxyRuntimeConfig: makeProxyRuntimeConfig({
				electricShapeUrl: ELECTRIC_SHAPE_URL,
				durableStreamsOrigin: DURABLE_STREAMS_ORIGIN,
			}),
			authLayer: Layer.succeed(JWTValidator, {
				validateJWT: () => Effect.fail({ _tag: 'UnexpectedJWTValidation' } as any),
			}),
		}),
	)
	runtimeDisposers.push(() => effectRuntime.dispose())
	return createApp({
		electricShapeUrl: ELECTRIC_SHAPE_URL,
		durableStreamsOrigin: DURABLE_STREAMS_ORIGIN,
		effectRuntime,
		testAuthContext: TEST_AUTH_CONTEXT,
		db: {} as any,
	})
}

describe('path parameter validation', () => {
	describe('/v1/sessions/:hostId', () => {
		test('rejects SQL injection payload in hostId with 400', async () => {
			const app = createTestApp()
			const response = await app.request("/v1/sessions/' OR 1=1) --", { method: 'GET' })
			expect(response.status).toBe(400)
			const body = (await response.json()) as { error: string }
			expect(body.error).toContain('Invalid hostId format')
		})

		test('rejects URL-encoded SQL injection payload in hostId with 400', async () => {
			const app = createTestApp()
			const response = await app.request('/v1/sessions/%27%20OR%201%3D1%29%20--', { method: 'GET' })
			expect(response.status).toBe(400)
		})

		test('rejects malformed non-UUID hostId with 400', async () => {
			const app = createTestApp()
			const response = await app.request('/v1/sessions/not-a-uuid', { method: 'GET' })
			expect(response.status).toBe(400)
		})

		test('accepts valid UUID hostId', async () => {
			const app = createTestApp()
			// Using a valid UUID format - will fail at proxy level (no upstream) but should not 400
			const response = await app.request('/v1/sessions/550e8400-e29b-41d4-a716-446655440000', { method: 'GET' })
			// Should not be 400 (validation passed), actual status depends on Electric upstream availability
			expect(response.status).not.toBe(400)
		})
	})

	describe('/v1/tasks/:taskId/artifacts', () => {
		test('rejects SQL injection payload in taskId with 400', async () => {
			const app = createTestApp()
			const response = await app.request("/v1/tasks/' OR 1=1 --/artifacts", { method: 'GET' })
			expect(response.status).toBe(400)
			const body = (await response.json()) as { error: string }
			expect(body.error).toContain('Invalid taskId format')
		})

		test('rejects URL-encoded SQL injection payload in taskId with 400', async () => {
			const app = createTestApp()
			const response = await app.request('/v1/tasks/%27%20OR%201%3D1%20--/artifacts', { method: 'GET' })
			expect(response.status).toBe(400)
		})

		test('rejects malformed non-UUID taskId with 400', async () => {
			const app = createTestApp()
			const response = await app.request('/v1/tasks/not-a-uuid/artifacts', { method: 'GET' })
			expect(response.status).toBe(400)
		})

		test('accepts valid UUID taskId', async () => {
			const app = createTestApp()
			const response = await app.request('/v1/tasks/550e8400-e29b-41d4-a716-446655440000/artifacts', {
				method: 'GET',
			})
			expect(response.status).not.toBe(400)
		})
	})

	describe('/v1/shared/artifacts/:artifactId', () => {
		test('rejects SQL injection payload in artifactId with 400', async () => {
			const app = createTestApp()
			const response = await app.request("/v1/shared/artifacts/' OR 1=1 --", {
				method: 'GET',
				headers: { 'x-share-key': 'some-key' },
			})
			expect(response.status).toBe(400)
			const body = (await response.json()) as { error: string }
			expect(body.error).toContain('Invalid artifactId format')
		})

		test('rejects URL-encoded SQL injection payload in artifactId with 400', async () => {
			const app = createTestApp()
			const response = await app.request('/v1/shared/artifacts/%27%20OR%201%3D1%20--', {
				method: 'GET',
				headers: { 'x-share-key': 'some-key' },
			})
			expect(response.status).toBe(400)
		})

		test('rejects malformed non-UUID artifactId with 400', async () => {
			const app = createTestApp()
			const response = await app.request('/v1/shared/artifacts/not-a-uuid', {
				method: 'GET',
				headers: { 'x-share-key': 'some-key' },
			})
			expect(response.status).toBe(400)
		})
	})

	describe('/v2/tasks/:taskId/artifacts', () => {
		test('rejects SQL injection payload in taskId with 400', async () => {
			const app = createTestApp()
			const response = await app.request("/v2/tasks/' OR 1=1 --/artifacts", { method: 'GET' })
			expect(response.status).toBe(400)
			const body = (await response.json()) as { error: string }
			expect(body.error).toContain('Invalid taskId format')
		})

		test('rejects malformed non-UUID taskId with 400', async () => {
			const app = createTestApp()
			const response = await app.request('/v2/tasks/not-a-uuid/artifacts', { method: 'GET' })
			expect(response.status).toBe(400)
		})

		test('accepts valid UUID taskId', async () => {
			const app = createTestApp()
			const response = await app.request('/v2/tasks/550e8400-e29b-41d4-a716-446655440000/artifacts', {
				method: 'GET',
			})
			expect(response.status).not.toBe(400)
		})
	})
})
