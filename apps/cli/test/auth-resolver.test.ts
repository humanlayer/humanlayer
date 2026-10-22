import { describe, expect, it } from 'vitest'

import { refreshWorkOSToken, resolveWorkOSTokenWithDeps } from '../src/auth'
import type { WorkOSSession } from '../src/auth/storage'

const envConfig = { apiOrigin: 'http://api.test', syncOrigin: 'http://sync.test', workosClientId: 'client_test' }

function session(overrides: Partial<WorkOSSession> = {}): WorkOSSession {
	return {
		access_token: 'access-old',
		refresh_token: 'refresh-old',
		expires_at: Date.now() + 60 * 60 * 1000,
		user_id: 'user-1',
		organization_id: 'org-1',
		...overrides,
	}
}

describe('resolveWorkOSToken', () => {
	it('returns a non-expired stored token', async () => {
		let saved: WorkOSSession | undefined
		const stored = session()
		const resolved = await resolveWorkOSTokenWithDeps('local', envConfig, {
			load: async () => stored,
			save: async (_env, value) => {
				saved = value
			},
			refresh: refreshWorkOSToken,
		})

		expect(resolved).toEqual(stored)
		expect(saved).toBeUndefined()
	})

	it('refreshes and persists a near-expiry token without bearer auth', async () => {
		let saved: WorkOSSession | undefined
		const stored = session({ expires_at: Date.now() + 60 * 1000 })
		const resolved = await resolveWorkOSTokenWithDeps('local', envConfig, {
			load: async () => stored,
			save: async (_env, value) => {
				saved = value
			},
			refresh: async (_apiOrigin, refreshToken) => {
				expect(refreshToken).toBe('refresh-old')
				return { accessToken: 'access-new', refreshToken: 'refresh-new' }
			},
		})

		expect(resolved.access_token).toBe('access-new')
		expect(resolved.refresh_token).toBe('refresh-new')
		expect(saved?.access_token).toBe('access-new')
	})

	it('re-reads disk after a refresh race', async () => {
		const expired = session({ expires_at: Date.now() - 1000 })
		const rotated = session({ access_token: 'access-rotated', refresh_token: 'refresh-rotated' })
		let loads = 0
		const resolved = await resolveWorkOSTokenWithDeps('local', envConfig, {
			load: async () => (++loads === 1 ? expired : rotated),
			save: async () => undefined,
			refresh: async () => {
				throw new Error('already rotated')
			},
		})

		expect(resolved).toEqual(rotated)
	})

	it('throws clear login guidance for missing non-interactive creds', async () => {
		await expect(
			resolveWorkOSTokenWithDeps('local', envConfig, {
				load: async () => null,
				save: async () => undefined,
				refresh: refreshWorkOSToken,
			}),
		).rejects.toThrow('Run `humanlayer login` first')
	})
})
