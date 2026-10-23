import { describe, it } from '@effect/vitest'
import { type CodexFetchLike } from '@humanlayer/agentlayer-provider-openai-codex'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { authorizeCodexDevice } from '@/effects/services/provider-login/drivers/codex-login-driver'
import type {
	ProviderLoginDriverContext,
	ProviderLoginPatch,
} from '@/effects/services/provider-login/provider-login.types'

function makeContext(signal: AbortSignal, updates: ProviderLoginPatch[]): ProviderLoginDriverContext {
	return {
		requestId: 'request-1',
		provider: 'codex',
		signal,
		update: async (patch) => {
			updates.push(patch)
		},
	}
}

const deviceResponse = () => Response.json({ device_auth_id: 'device-1', user_code: 'ABCD', interval: '1' })

describe('Codex device authorization', () => {
	it.effect('returns credentials only after approval and token exchange', () =>
		Effect.promise(async () => {
			const abort = new AbortController()
			const updates: ProviderLoginPatch[] = []
			const paths: string[] = []
			const fetch: CodexFetchLike = async (input, init) => {
				expect(init?.signal).toBe(abort.signal)
				const path = new URL(String(input)).pathname
				paths.push(path)
				switch (path) {
					case '/api/accounts/deviceauth/usercode':
						return deviceResponse()
					case '/api/accounts/deviceauth/token':
						return Response.json({ authorization_code: 'approved', code_verifier: 'verifier' })
					case '/oauth/token':
						return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })
					default:
						throw new Error(`Unexpected request: ${path}`)
				}
			}
			const auth = await Effect.runPromise(authorizeCodexDevice(makeContext(abort.signal, updates), fetch))
			expect(auth).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' })
			expect(paths).toEqual([
				'/api/accounts/deviceauth/usercode',
				'/api/accounts/deviceauth/token',
				'/oauth/token',
			])
			expect(updates).toEqual([
				{ status: 'awaiting_approval', url: 'https://auth.openai.com/codex/device', userCode: 'ABCD' },
			])
		}),
	)

	for (const reason of ['cancelled', 'timed_out'] as const) {
		for (const stage of ['usercode', 'token', 'exchange'] as const) {
			it.effect(`does not return credentials after ${reason} during ${stage}`, () =>
				Effect.promise(async () => {
					const abort = new AbortController()
					const updates: ProviderLoginPatch[] = []
					const paths: string[] = []
					const fetch: CodexFetchLike = async (input, init) => {
						expect(init?.signal).toBe(abort.signal)
						const path = new URL(String(input)).pathname
						paths.push(path)
						if (path.endsWith('/usercode')) {
							if (stage === 'usercode') abort.abort(reason)
							return deviceResponse()
						}
						if (path.endsWith('/deviceauth/token')) {
							if (stage === 'token') abort.abort(reason)
							return Response.json({ authorization_code: 'late-approval', code_verifier: 'verifier' })
						}
						if (path === '/oauth/token') {
							abort.abort(reason)
							return Response.json({ access_token: 'late-access', refresh_token: 'late-refresh' })
						}
						throw new Error(`Unexpected request: ${path}`)
					}
					await expect(
						Effect.runPromise(authorizeCodexDevice(makeContext(abort.signal, updates), fetch)),
					).rejects.toMatchObject({ reason })
					expect(paths).toHaveLength(stage === 'usercode' ? 1 : stage === 'token' ? 2 : 3)
					if (stage === 'usercode') expect(updates).toEqual([])
				}),
			)
		}
	}

	it.effect('does not start a request when already cancelled', () =>
		Effect.promise(async () => {
			const abort = new AbortController()
			abort.abort('cancelled')
			await expect(
				Effect.runPromise(
					authorizeCodexDevice(makeContext(abort.signal, []), async () => {
						throw new Error('Cancelled sign-in must not fetch')
					}),
				),
			).rejects.toMatchObject({ reason: 'cancelled' })
		}),
	)
})
