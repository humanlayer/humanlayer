import { randomUUID } from 'node:crypto'

import { WorkOS } from '@workos-inc/node'
import { describe, expect, it } from 'vitest'

type WorkosCallResult =
	| { readonly ok: true }
	| {
			readonly ok: false
			readonly name: string
			readonly message: string
			readonly status?: number
			readonly code?: string
	  }

const describeWorkosError = (error: unknown): WorkosCallResult => {
	if (error && typeof error === 'object') {
		const fields = error as { name?: unknown; message?: unknown; status?: unknown; code?: unknown }
		return {
			ok: false,
			name: typeof fields.name === 'string' ? fields.name : 'UnknownError',
			message: typeof fields.message === 'string' ? fields.message : String(error),
			status: typeof fields.status === 'number' ? fields.status : undefined,
			code: typeof fields.code === 'string' ? fields.code : undefined,
		}
	}
	return { ok: false, name: 'UnknownError', message: String(error) }
}

const captureWorkosResult = async (operation: () => Promise<void>): Promise<WorkosCallResult> => {
	try {
		await operation()
		return { ok: true }
	} catch (error) {
		return describeWorkosError(error)
	}
}

describe('WorkOS user API key membership lifecycle learning', () => {
	it.skipIf(!process.env.WORKOS_API_KEY || process.env.WORKOS_API_KEY === 'sk_test')(
		'invalidates a user API key when its organization membership is deactivated',
		async () => {
			const workos = new WorkOS(process.env.WORKOS_API_KEY)
			const id = randomUUID()
			console.info('Creating WorkOS learning organization')
			const organization = await workos.organizations.createOrganization({
				name: `Learning inactive membership delete ${id}`,
				externalId: `learning-inactive-membership-delete-${id}`,
				metadata: { learning_test: 'inactive_membership_delete' },
			})
			const existingUsers = await workos.userManagement.listUsers({ limit: 1 })
			const [existingUser] = await existingUsers.autoPagination()
			if (!existingUser)
				throw new Error('WorkOS account must have at least one existing user to run this learning test')
			let membershipId: string | null = null
			let apiKeyId: string | null = null

			try {
				const membership = await workos.userManagement.createOrganizationMembership({
					organizationId: organization.id,
					userId: existingUser.id,
				})
				membershipId = membership.id
				const apiKey = await workos.userManagement.createUserApiKey(existingUser.id, {
					name: `Membership lifecycle learning ${id}`,
					organizationId: organization.id,
					expiresAt: new Date(Date.now() + 60 * 60 * 1000),
				})
				apiKeyId = apiKey.id
				const validationBeforeDeactivation = await workos.apiKeys.createValidation({ value: apiKey.value })
				expect(validationBeforeDeactivation.apiKey?.id).toBe(apiKey.id)

				const inactiveMembership = await workos.userManagement.deactivateOrganizationMembership(membership.id)
				expect(inactiveMembership.status).toBe('inactive')

				const validationAfterDeactivation = await workos.apiKeys.createValidation({ value: apiKey.value })
				expect(validationAfterDeactivation.apiKey).toBeNull()
			} finally {
				if (apiKeyId) {
					await captureWorkosResult(() => workos.apiKeys.deleteApiKey(apiKeyId!))
				}
				if (membershipId) {
					const cleanupMembershipId = membershipId
					await captureWorkosResult(async () => {
						await workos.userManagement.reactivateOrganizationMembership(cleanupMembershipId)
						await workos.userManagement.deleteOrganizationMembership(cleanupMembershipId)
					})
				}
				await captureWorkosResult(() => workos.organizations.deleteOrganization(organization.id))
			}
		},
		45_000,
	)
})
