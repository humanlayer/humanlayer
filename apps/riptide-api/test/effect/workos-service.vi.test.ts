import { describe, it } from '@effect/vitest'
import { GenericServerException, RateLimitExceededException } from '@workos-inc/node'
import { Effect, Result } from 'effect'

import { WorkosRateLimitError, WorkosServerError } from '../../src/effects/services/workos/workos.errors'
import { makeWorkosServiceLive, WorkosService } from '../../src/effects/services/workos/workos.service'
import type { WorkosSdkAdapter } from '../../src/lib/workos-service'

function makeWorkosLayer(overrides: Partial<WorkosSdkAdapter>) {
	const workos = {
		config: { clientId: 'client_test', redirectUri: 'http://localhost/callback' },
		countActiveOrganizationMemberships: async () => 1,
		countPendingInvitations: async () => 0,
		verifyWebhook: async () => ({ id: 'evt_test', event: 'test.event', data: {} }),
		getMembershipWebhookEvent: () => null,
		userManagement: {
			createUserApiKey: async () => {
				throw new Error('createUserApiKey not implemented')
			},
			listUserApiKeys: async () => {
				throw new Error('listUserApiKeys not implemented')
			},
		},
		organizations: {},
		adminPortal: {},
		apiKeys: {},
		...overrides,
	} as WorkosSdkAdapter

	return makeWorkosServiceLive(workos)
}

describe('WorkosServiceLive', () => {
	it.effect('counts only pending invitations from the paginated WorkOS list', ({ expect }) =>
		Effect.gen(function* () {
			const service = yield* WorkosService
			const count = yield* service.countPendingInvitations({ workosOrganizationId: 'org_workos_123' })

			expect(count).toBe(2)
		}).pipe(
			Effect.provide(
				makeWorkosLayer({
					userManagement: {
						listInvitations: async (input: { organizationId: string }) => {
							expect(input).toEqual({ organizationId: 'org_workos_123' })
							return {
								autoPagination: async () => [
									{ id: 'inv_pending_1', state: 'pending' },
									{ id: 'inv_accepted', state: 'accepted' },
									{ id: 'inv_pending_2', state: 'pending' },
									{ id: 'inv_revoked', state: 'revoked' },
								],
							}
						},
					} as any,
				}),
			),
		),
	)

	it.effect('classifies WorkOS rate-limit failures from pending invitation counts', ({ expect }) =>
		Effect.gen(function* () {
			const service = yield* WorkosService

			const result = yield* Effect.result(
				service.countPendingInvitations({ workosOrganizationId: 'org_workos_rate_limited' }),
			)

			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) {
				expect(result.failure).toBeInstanceOf(WorkosRateLimitError)
				if (result.failure instanceof WorkosRateLimitError) {
					expect(result.failure.retryAfterMs).toBe(2_000)
				}
			}
		}).pipe(
			Effect.provide(
				makeWorkosLayer({
					userManagement: {
						listInvitations: async () => {
							throw new RateLimitExceededException('rate limited', 'request_rate_limited', 2)
						},
					} as any,
				}),
			),
		),
	)

	it.effect('classifies WorkOS server failures from pending invitation counts', ({ expect }) =>
		Effect.gen(function* () {
			const service = yield* WorkosService

			const result = yield* Effect.result(
				service.countPendingInvitations({ workosOrganizationId: 'org_workos_unavailable' }),
			)

			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) {
				expect(result.failure).toBeInstanceOf(WorkosServerError)
			}
		}).pipe(
			Effect.provide(
				makeWorkosLayer({
					userManagement: {
						listInvitations: async () => {
							throw new GenericServerException(
								503,
								'WorkOS is unavailable',
								{ message: 'WorkOS is unavailable' },
								'request_unavailable',
							)
						},
					} as any,
				}),
			),
		),
	)
})
