import { call } from '@orpc/server'
import { describe, expect, test } from 'vitest'

import { refreshTokenProcedure } from '../../src/orpc/api/auth/token-refresh'
import { createMockApiContextNoOrg, createMockWorkosService } from '../mocks'

describe('refreshToken', () => {
	test('refreshes a session without a valid access-token context', async () => {
		let receivedInput: unknown
		const context = createMockApiContextNoOrg({
			auth: null,
			services: {
				workos: createMockWorkosService({
					userManagement: {
						authenticateWithRefreshToken: async (input: unknown) => {
							receivedInput = input
							return {
								user: { id: 'user-1' },
								accessToken: 'access-new',
								refreshToken: 'refresh-new',
							} as never
						},
					},
				}),
			},
		})

		const result = await call(refreshTokenProcedure, { refreshToken: 'refresh-old' }, { context })

		expect(receivedInput).toMatchObject({ refreshToken: 'refresh-old' })
		expect(result).toEqual({ accessToken: 'access-new', refreshToken: 'refresh-new' })
	})
})
