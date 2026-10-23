import { contractBuilder } from '@humanlayer/riptide-api-contract/contract-builder'
import { call, implement, isDefinedError } from '@orpc/server'
import { afterEach, describe, expect, test } from 'vitest'
import z from 'zod/v4'

import type { AuthContext, AuthContextOptionalOrg } from '../src/auth/jwt-validator'
import type { ApiContext } from '../src/orpc/base'
import { isAuthContextWithOrg, requireOrganization, requiresBillingMiddleware } from '../src/orpc/base'
import { createMockApiContext, createMockApiContextNoOrg, billingAccessLayer } from './mocks'
import { requireExternalTestServices } from './utils/external-test-services'

await requireExternalTestServices()

// Bare auth literals retained ONLY for the isAuthContextWithOrg type-guard unit
// tests below — these exercise the guard directly, they do not build a context.
const mockAuthWithOrg: AuthContext = {
	userId: 'user-123',
	organizationId: 'org-456',
	workosOrganizationId: 'workos-org-789',
	role: '',
	roles: [],
	permissions: [],
	entitlements: [],
	sessionId: 'session-abc',
}

const mockAuthWithoutOrg: AuthContextOptionalOrg = {
	userId: 'user-123',
	organizationId: undefined,
	workosOrganizationId: undefined,
	role: '',
	roles: [],
	permissions: [],
	entitlements: [],
	sessionId: 'session-abc',
}

// Mock db for tests - these tests don't actually call db methods
const mockDb = {} as any

// Create test contract with required procedures
const testContract = {
	orgRequired: contractBuilder.input(z.object({})).output(z.object({ success: z.boolean() })),
	orgOptional: contractBuilder.input(z.object({})).output(z.object({ success: z.boolean() })),
}

// Create implementer for test contract
const testOs = implement(testContract)

// Create test procedure that requires organization (uses requireOrganization middleware)
const testOrgRequiredProcedure = testOs
	.$context<ApiContext>()
	.use(async ({ context, next, errors }) => {
		if (!context.auth) throw errors.UNAUTHORIZED()
		return next({ context: { auth: context.auth, services: context.services } })
	})
	.use(requireOrganization)
	.orgRequired.handler(() => ({ success: true }))

const testBillingRequiredProcedure = testOs
	.$context<ApiContext>()
	.use(async ({ context, next, errors }) => {
		if (!context.auth) throw errors.UNAUTHORIZED()
		return next({ context: { auth: context.auth, services: context.services } })
	})
	.use(requireOrganization)
	.use(requiresBillingMiddleware)
	.orgRequired.handler(() => ({ success: true }))

// Create test procedure that is org-optional (no requireOrganization middleware)
const testOrgOptionalProcedure = testOs
	.$context<ApiContext>()
	.use(async ({ context, next, errors }) => {
		if (!context.auth) throw errors.UNAUTHORIZED()
		return next({ context: { auth: context.auth!, services: context.services } })
	})
	.orgOptional.handler(() => ({ success: true }))

describe('isAuthContextWithOrg type guard', () => {
	test('returns false for undefined organizationId', () => {
		expect(isAuthContextWithOrg(mockAuthWithoutOrg)).toBe(false)
	})

	test('returns false for empty string organizationId', () => {
		expect(isAuthContextWithOrg({ ...mockAuthWithOrg, organizationId: '' })).toBe(false)
	})

	test('returns false for empty string workosOrganizationId', () => {
		expect(isAuthContextWithOrg({ ...mockAuthWithOrg, workosOrganizationId: '' })).toBe(false)
	})

	test('returns true for valid org context', () => {
		expect(isAuthContextWithOrg(mockAuthWithOrg)).toBe(true)
	})
})

describe('API Middleware - apiBase (org-required routes)', () => {
	test('throws UNAUTHORIZED when auth context is null', async () => {
		try {
			await call(
				testOrgRequiredProcedure,
				{},
				{
					context: createMockApiContext({ auth: null, services: { db: mockDb, dbReadReplica: mockDb } }),
				},
			)
			expect.unreachable('Should have thrown')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('UNAUTHORIZED')
		}
	})

	test('throws ORGANIZATION_REQUIRED when auth has no org', async () => {
		try {
			await call(
				testOrgRequiredProcedure,
				{},
				{
					context: createMockApiContextNoOrg({
						auth: { userId: 'user-123' },
						services: { db: mockDb, dbReadReplica: mockDb },
					}),
				},
			)
			expect.unreachable('Should have thrown')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('ORGANIZATION_REQUIRED')
		}
	})

	test('succeeds when auth has valid org context', async () => {
		const result = await call(
			testOrgRequiredProcedure,
			{},
			{
				context: createMockApiContext({
					auth: { userId: 'user-123', organizationId: 'org-456', workosOrganizationId: 'workos-org-789' },
					services: { db: mockDb, dbReadReplica: mockDb },
				}),
			},
		)
		expect(result).toEqual({ success: true })
	})
})

describe('API Middleware - apiBaseNoOrg (org-optional routes)', () => {
	test('throws UNAUTHORIZED when auth context is null', async () => {
		try {
			await call(
				testOrgOptionalProcedure,
				{},
				{
					context: createMockApiContextNoOrg({ auth: null, services: { db: mockDb, dbReadReplica: mockDb } }),
				},
			)
			expect.unreachable('Should have thrown')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('UNAUTHORIZED')
		}
	})

	test('succeeds when auth has no org', async () => {
		const result = await call(
			testOrgOptionalProcedure,
			{},
			{
				context: createMockApiContextNoOrg({
					auth: { userId: 'user-123' },
					services: { db: mockDb, dbReadReplica: mockDb },
				}),
			},
		)
		expect(result).toEqual({ success: true })
	})

	test('succeeds when auth has valid org context', async () => {
		const result = await call(
			testOrgOptionalProcedure,
			{},
			{
				context: createMockApiContext({
					auth: { userId: 'user-123', organizationId: 'org-456', workosOrganizationId: 'workos-org-789' },
					services: { db: mockDb, dbReadReplica: mockDb },
				}),
			},
		)
		expect(result).toEqual({ success: true })
	})

	// Note: Full success tests require mocking WorkOS SDK
	// These tests verify middleware behavior, not handler logic
})

describe('requiresBillingMiddleware', () => {
	const originalBillingEnforcement = process.env.IS_BILLING_ENFORCEMENT_ENABLED ?? 'false'
	afterEach(() => {
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = originalBillingEnforcement
	})

	test('short-circuits when billing enforcement is disabled', async () => {
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		let evaluateCalled = false

		const result = await call(
			testBillingRequiredProcedure,
			{},
			{
				context: createMockApiContext({
					auth: { userId: 'user-123', organizationId: 'org-456', workosOrganizationId: 'workos-org-789' },
					services: {
						db: mockDb,
						dbReadReplica: mockDb,
					},
					billingAccess: billingAccessLayer({
						decide: async () => {
							evaluateCalled = true
							return 'blocked'
						},
					}),
				}),
			},
		)

		expect(result).toEqual({ success: true })
		expect(evaluateCalled).toBe(false)
	})

	test('throws BILLING_REQUIRED with no client-visible billing details when blocked', async () => {
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'

		try {
			await call(
				testBillingRequiredProcedure,
				{},
				{
					context: createMockApiContext({
						auth: { userId: 'user-123', organizationId: 'org-456', workosOrganizationId: 'workos-org-789' },
						services: {
							db: mockDb,
							dbReadReplica: mockDb,
						},
						billingAccess: billingAccessLayer({ decision: 'blocked' }),
					}),
				},
			)
			expect.unreachable('Should have thrown')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('BILLING_REQUIRED')
			expect(error.data).toBeUndefined()
		}
	})

	test('passes through when billing access fails open', async () => {
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'

		const result = await call(
			testBillingRequiredProcedure,
			{},
			{
				context: createMockApiContext({
					auth: { userId: 'user-123', organizationId: 'org-456', workosOrganizationId: 'workos-org-789' },
					services: {
						db: mockDb,
						dbReadReplica: mockDb,
					},
					billingAccess: billingAccessLayer({ decision: 'fail_open' }),
				}),
			},
		)

		expect(result).toEqual({ success: true })
	})

	test('passes operation path only as telemetry to billing access service', async () => {
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		let observedInput: { organizationId: string; operation: string } | undefined

		await call(
			testBillingRequiredProcedure,
			{},
			{
				context: createMockApiContext({
					auth: { userId: 'user-123', organizationId: 'org-456', workosOrganizationId: 'workos-org-789' },
					services: {
						db: mockDb,
						dbReadReplica: mockDb,
					},
					billingAccess: billingAccessLayer({
						decide: async (input) => {
							observedInput = input
							return 'allowed'
						},
					}),
				}),
			},
		)

		expect(observedInput?.organizationId).toBe(mockAuthWithOrg.organizationId)
		expect(typeof observedInput?.operation).toBe('string')
	})

	test('throws SERVICE_UNAVAILABLE when billing access service throws unexpectedly', async () => {
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'

		try {
			await call(
				testBillingRequiredProcedure,
				{},
				{
					context: createMockApiContext({
						auth: { userId: 'user-123', organizationId: 'org-456', workosOrganizationId: 'workos-org-789' },
						services: {
							db: mockDb,
							dbReadReplica: mockDb,
						},
						billingAccess: billingAccessLayer({
							decide: async () => {
								throw new Error('unexpected billing service failure')
							},
						}),
					}),
				},
			)
			expect.unreachable('Should have thrown')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('SERVICE_UNAVAILABLE')
		}
	})
})
