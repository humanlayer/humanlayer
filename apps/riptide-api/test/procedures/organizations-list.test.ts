import { call, isDefinedError } from '@orpc/server'
import { describe, expect, test } from 'vitest'

import { listUserOrganizationsProcedure } from '../../src/orpc/api/auth/user/organizations-list'
import { createMockApiContextNoOrg, createMockWorkosService } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'

await requireExternalTestServices()

describe('listUserOrganizations', () => {
	test('returns organizations with sign-in URLs', async () => {
		const mockContext = createMockApiContextNoOrg({
			auth: {
				userId: 'user-123',
			},
			services: {
				workos: createMockWorkosService({
					userManagement: {
						listOrganizationMemberships: async () =>
							({
								data: [
									{ organizationId: 'org-1', role: { slug: 'admin' } },
									{ organizationId: 'org-2', role: { slug: 'member' } },
								],
								autoPagination: async () => [
									{ organizationId: 'org-1', role: { slug: 'admin' } },
									{ organizationId: 'org-2', role: { slug: 'member' } },
								],
							}) as any,
						getAuthorizationUrl: ({ organizationId }: any) =>
							`https://auth.workos.com/sso?org=${organizationId}`,
					},
					organizations: {
						getOrganization: async (id: string) =>
							({
								id,
								name: `Org ${id}`,
								domains: [{ domain: `${id}.example.com`, state: 'verified' }],
							}) as any,
					},
				}),
			},
		})

		const result = await call(listUserOrganizationsProcedure, {}, { context: mockContext })

		expect(result.organizations).toHaveLength(2)
		expect(result.organizations[0]?.organizationId).toBe('org-1')
		expect(result.organizations[0]?.organizationName).toBe('Org org-1')
		expect(result.organizations[0]?.role).toBe('admin')
		expect(result.organizations[0]?.signInUrl).toContain('org-1')
		expect(result.organizations[0]?.domains).toEqual(['org-1.example.com'])

		expect(result.organizations[1]?.organizationId).toBe('org-2')
		expect(result.organizations[1]?.organizationName).toBe('Org org-2')
		expect(result.organizations[1]?.role).toBe('member')
		expect(result.organizations[1]?.signInUrl).toContain('org-2')
		expect(result.organizations[1]?.domains).toEqual(['org-2.example.com'])

		expect(result.activeOrganizationId).toBeNull()
	})

	test('returns activeOrganizationId when user has active org', async () => {
		const mockContext = createMockApiContextNoOrg({
			auth: {
				userId: 'user-123',
				organizationId: 'org-1', // Active org selected
			},
			services: {
				workos: createMockWorkosService({
					userManagement: {
						listOrganizationMemberships: async () =>
							({
								data: [{ organizationId: 'org-1', role: { slug: 'admin' } }],
								autoPagination: async () => [{ organizationId: 'org-1', role: { slug: 'admin' } }],
							}) as any,
						getAuthorizationUrl: ({ organizationId }: any) =>
							`https://auth.workos.com/sso?org=${organizationId}`,
					},
					organizations: {
						getOrganization: async (id: string) =>
							({
								id,
								name: `Org ${id}`,
								domains: [],
							}) as any,
					},
				}),
			},
		})

		const result = await call(listUserOrganizationsProcedure, {}, { context: mockContext })

		expect(result.activeOrganizationId).toBe('org-1')
	})

	test('filters out non-verified domains', async () => {
		const mockContext = createMockApiContextNoOrg({
			auth: {
				userId: 'user-123',
			},
			services: {
				workos: createMockWorkosService({
					userManagement: {
						listOrganizationMemberships: async () =>
							({
								data: [{ organizationId: 'org-1', role: { slug: 'admin' } }],
								autoPagination: async () => [{ organizationId: 'org-1', role: { slug: 'admin' } }],
							}) as any,
						getAuthorizationUrl: ({ organizationId }: any) =>
							`https://auth.workos.com/sso?org=${organizationId}`,
					},
					organizations: {
						getOrganization: async (id: string) =>
							({
								id,
								name: `Org ${id}`,
								domains: [
									{ domain: 'verified.example.com', state: 'verified' },
									{ domain: 'pending.example.com', state: 'pending' },
									{ domain: 'failed.example.com', state: 'failed' },
								],
							}) as any,
					},
				}),
			},
		})

		const result = await call(listUserOrganizationsProcedure, {}, { context: mockContext })

		expect(result.organizations[0]?.domains).toEqual(['verified.example.com'])
	})

	test('handles missing role gracefully', async () => {
		const mockContext = createMockApiContextNoOrg({
			auth: {
				userId: 'user-123',
			},
			services: {
				workos: createMockWorkosService({
					userManagement: {
						listOrganizationMemberships: async () =>
							({
								data: [{ organizationId: 'org-1', role: undefined }],
								autoPagination: async () => [{ organizationId: 'org-1', role: undefined }],
							}) as any,
						getAuthorizationUrl: ({ organizationId }: any) =>
							`https://auth.workos.com/sso?org=${organizationId}`,
					},
					organizations: {
						getOrganization: async (id: string) =>
							({
								id,
								name: `Org ${id}`,
								domains: [],
							}) as any,
					},
				}),
			},
		})

		const result = await call(listUserOrganizationsProcedure, {}, { context: mockContext })

		expect(result.organizations[0]?.role).toBe('member')
	})

	test('throws UNAUTHORIZED when auth is null', async () => {
		const context = createMockApiContextNoOrg({ auth: null })

		try {
			await call(listUserOrganizationsProcedure, {}, { context })
			expect.unreachable('Should have thrown')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('UNAUTHORIZED')
		}
	})
})
