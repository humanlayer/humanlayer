import { once } from 'node:events'

import { serve } from '@hono/node-server'
import { getExternalTestServicesConfig } from '@humanlayer/test-fixtures/external-test-services'
import { Effect, Layer } from 'effect'
import { generateKeyPair, SignJWT } from 'jose'

import { JWKSCache } from '../src/auth/effect/jwks-cache.service'
import { JWTValidatorLive } from '../src/auth/effect/jwt-validator.service'
import { makeProxyRuntimeConfig } from '../src/lib/effect/proxy-runtime-config.service'
import { createAppRuntime, makeAppLayer } from '../src/lib/effect/runtime'
import type { DbClient } from '../src/lib/queries'
import { createApp } from '../src/server'

export const durableStreamsOrigin = getExternalTestServicesConfig().durableStreamsOrigin

/** Real JWT verification with a locally issued key instead of calling WorkOS. */
export async function startAuthenticatedProxy(db: DbClient, upstream: string) {
	const { publicKey, privateKey } = await generateKeyPair('RS256')
	const runtime = createAppRuntime(
		makeAppLayer({
			proxyRuntimeConfig: makeProxyRuntimeConfig({
				electricShapeUrl: 'http://127.0.0.1:1/v1/shape',
				durableStreamsOrigin: upstream,
			}),
			authLayer: JWTValidatorLive.pipe(
				Layer.provide(
					Layer.succeed(JWKSCache, {
						getKey: () => Effect.succeed(publicKey),
						isReady: Effect.succeed(true),
						forceRefresh: Effect.void,
					}),
				),
			),
		}),
	)
	const app = createApp({
		db,
		effectRuntime: runtime,
		electricShapeUrl: 'http://127.0.0.1:1/v1/shape',
		durableStreamsOrigin: upstream,
		validateDaemonToken: async () => null,
	})
	const requests: { method: string; url: URL; token: string | null }[] = []
	const server = serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch: (request) => {
			requests.push({
				method: request.method,
				url: new URL(request.url),
				token: request.headers.get('authorization'),
			})
			return app.fetch(request)
		},
	})
	if (!server.listening) await once(server, 'listening')
	const address = server.address()
	if (!address || typeof address === 'string') throw new Error('No proxy port')
	return {
		origin: `http://127.0.0.1:${address.port}`,
		requests,
		token: (userId: string, organizationId: string, expires = '1h') =>
			new SignJWT({
				sub: userId,
				org_id: 'org_workos_test',
				internal_org_id: organizationId,
				role: 'member',
				roles: [],
				permissions: [],
				entitlements: [],
				sid: 'session_test',
			})
				.setProtectedHeader({ alg: 'RS256', kid: 'local-key' })
				.setIssuer('https://test.workos.local')
				.setIssuedAt()
				.setExpirationTime(expires)
				.sign(privateKey),
		stop: async () => {
			await runtime.dispose()
			if ('closeAllConnections' in server) server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		},
	}
}

export async function startStorageRecorder(upstream?: string) {
	const requests: { method: string; path: string; headers: Headers; body: Uint8Array }[] = []
	const server = serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch: async (request) => {
			const url = new URL(request.url)
			const body = new Uint8Array(await request.arrayBuffer())
			requests.push({ method: request.method, path: url.pathname, headers: request.headers, body })
			if (!upstream) return new Response(request.method === 'HEAD' ? null : body, { status: 200 })
			if (!url.pathname.startsWith('/durable-streams/')) return new Response(null, { status: 400 })
			const response = await fetch(`${upstream}${url.pathname.slice('/durable-streams'.length)}${url.search}`, {
				method: request.method,
				headers: request.headers,
				body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
			})
			if (request.method === 'GET' || request.method === 'HEAD') return response
			const responseBody = [204, 205, 304].includes(response.status) ? null : await response.arrayBuffer()
			return new Response(responseBody, { status: response.status, headers: response.headers })
		},
	})
	if (!server.listening) await once(server, 'listening')
	const address = server.address()
	if (!address || typeof address === 'string') throw new Error('No recorder port')
	return {
		origin: `http://127.0.0.1:${address.port}/durable-streams`,
		requests,
		stop: async () => {
			if ('closeAllConnections' in server) server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		},
	}
}
