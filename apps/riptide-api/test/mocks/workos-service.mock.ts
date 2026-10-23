import { OrganizationDomainState, OrganizationDomainVerificationStrategy } from '@workos-inc/node'

import type { WorkosEvent, WorkosSdkAdapter, WorkosWebhookMembershipEvent } from '../../src/lib/workos-service'

/**
 * Mock data types for stateful WorkOS service
 */
export interface MockUser {
	id: string
	email: string
	firstName?: string
	lastName?: string
	emailVerified: boolean
	profilePictureUrl?: string
	createdAt: string
	updatedAt: string
}

export interface MockOrganization {
	id: string
	name: string
	allowProfilesOutsideOrganization: boolean
	domains: MockOrganizationDomain[]
	createdAt: string
	updatedAt: string
	externalId: string | null
	stripeCustomerId: string | null
	metadata: Record<string, string>
}

export interface MockOrganizationDomain {
	id: string
	domain: string
	state: 'legacy_verified' | 'verified' | 'pending' | 'failed'
}

export interface MockOrganizationMembership {
	id: string
	userId: string
	organizationId: string
	organizationName: string
	status: 'active' | 'inactive' | 'pending'
	role: { slug: string }
	createdAt: string
	updatedAt: string
}

export interface MockInvitation {
	id: string
	email: string
	state: 'pending' | 'accepted' | 'expired' | 'revoked'
	token: string
	organizationId: string
	createdAt: string
	updatedAt: string
	expiresAt: string
}

/**
 * Stateful mock WorkOS service that manages its own state with Maps.
 * Easy to create, reset, and destroy. All methods are public for spyOn.
 *
 * @example
 * ```ts
 * const workos = new StatefulMockWorkosService()
 *
 * // Seed data
 * workos.addUser({ id: 'user-1', email: 'test@example.com' })
 * workos.addOrganization({ id: 'org-1', name: 'Test Org' })
 * workos.addMembership({ userId: 'user-1', organizationId: 'org-1', role: { slug: 'admin' } })
 *
 * // Use in tests
 * const context = { auth: mockAuth, services: { workos, db } }
 * const result = await call(procedure, input, { context })
 *
 * // Reset between tests
 * workos.reset()
 * ```
 */
export class StatefulMockWorkosService implements WorkosSdkAdapter {
	// WorkOS config - injectable for tests
	config = {
		redirectUri: 'https://mock-redirect.example.com/callback',
		clientId: 'mock-client-id',
	}

	// Public state stores - accessible for assertions and seeding
	// Prefixed with _ to avoid conflict with WorkosSdkAdapter properties
	_users = new Map<string, MockUser>()
	_organizations = new Map<string, MockOrganization>()
	_memberships = new Map<string, MockOrganizationMembership>()
	_invitations = new Map<string, MockInvitation>()
	_invitationsByToken = new Map<string, string>() // token -> invitation id

	constructor() {
		this.reset()
	}

	async countActiveOrganizationMemberships(workosOrganizationId: string): Promise<number> {
		const count = Array.from(this._memberships.values()).filter(
			(membership) => membership.organizationId === workosOrganizationId && membership.status === 'active',
		).length
		return Math.max(count, 1)
	}

	async countPendingInvitations(input: { workosOrganizationId: string }): Promise<number> {
		return Array.from(this._invitations.values()).filter(
			(invitation) => invitation.organizationId === input.workosOrganizationId && invitation.state === 'pending',
		).length
	}

	async verifyWebhook(payload: string): Promise<WorkosEvent> {
		return JSON.parse(payload) as WorkosEvent
	}

	getMembershipWebhookEvent(event: WorkosEvent): WorkosWebhookMembershipEvent | null {
		if (
			event.event !== 'organization_membership.created' &&
			event.event !== 'organization_membership.updated' &&
			event.event !== 'organization_membership.deleted'
		) {
			return null
		}

		return {
			eventId: event.id,
			eventType: event.event,
			workosOrganizationId: String(event.data.organizationId),
			userId: String(event.data.userId),
		}
	}

	/**
	 * Reset all state - call between tests
	 */
	reset(): void {
		this._users.clear()
		this._organizations.clear()
		this._memberships.clear()
		this._invitations.clear()
		this._invitationsByToken.clear()
	}

	/**
	 * Generate a unique ID
	 */
	generateId(prefix = 'mock'): string {
		return `${prefix}_${crypto.randomUUID()}`
	}

	// ============ Data Seeding Methods ============

	addUser(data: Partial<MockUser> & { id: string; email: string }): MockUser {
		const user: MockUser = {
			firstName: 'Test',
			lastName: 'User',
			emailVerified: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			...data,
		}
		this._users.set(user.id, user)
		return user
	}

	addOrganization(data: Partial<MockOrganization> & { id: string; name: string }): MockOrganization {
		const org: MockOrganization = {
			allowProfilesOutsideOrganization: false,
			domains: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			externalId: null,
			stripeCustomerId: null,
			metadata: {},
			...data,
		}
		this._organizations.set(org.id, org)
		return org
	}

	addMembership(
		data: Partial<MockOrganizationMembership> & {
			userId: string
			organizationId: string
		},
	): MockOrganizationMembership {
		const org = this._organizations.get(data.organizationId)
		const membership: MockOrganizationMembership = {
			id: data.id ?? this.generateId('om'),
			organizationName: org?.name ?? 'Unknown Org',
			status: 'active',
			role: { slug: 'member' },
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			...data,
		}
		this._memberships.set(membership.id, membership)
		return membership
	}

	addInvitation(
		data: Partial<MockInvitation> & {
			email: string
			organizationId: string
		},
	): MockInvitation {
		const invitation: MockInvitation = {
			id: data.id ?? this.generateId('inv'),
			state: 'pending',
			token: data.token ?? this.generateId('token'),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
			...data,
		}
		this._invitations.set(invitation.id, invitation)
		this._invitationsByToken.set(invitation.token, invitation.id)
		return invitation
	}

	// ============ WorkosSdkAdapter Implementation ============
	// Methods are typed as `any` to avoid strict type checking against WorkOS SDK types.
	// The mock returns simplified objects that work for testing purposes.

	userManagement: WorkosSdkAdapter['userManagement'] = {
		createUserApiKey: async () => {
			throw new Error('Mock WorkOS method not implemented: userManagement.createUserApiKey')
		},
		listUserApiKeys: async () => {
			throw new Error('Mock WorkOS method not implemented: userManagement.listUserApiKeys')
		},
		getUser: async (userId: string): Promise<any> => {
			const user = this._users.get(userId)
			if (!user) throw new Error(`User not found: ${userId}`)
			return {
				object: 'user',
				id: user.id,
				email: user.email,
				firstName: user.firstName,
				lastName: user.lastName,
				emailVerified: user.emailVerified,
				profilePictureUrl: user.profilePictureUrl ?? null,
				createdAt: user.createdAt,
				updatedAt: user.updatedAt,
				lastSignInAt: null,
				locale: 'en',
				externalId: null,
				metadata: {},
			}
		},

		listInvitations: async (options: any): Promise<any> => {
			const results = Array.from(this._invitations.values()).filter((inv) => {
				if (options.email && inv.email !== options.email) return false
				if (options.organizationId && inv.organizationId !== options.organizationId) return false
				return true
			})
			return this._createAutoPaginatable(
				results.map((inv) => ({
					object: 'invitation',
					...inv,
				})),
			)
		},

		findInvitationByToken: async (token: string): Promise<any> => {
			const invId = this._invitationsByToken.get(token)
			if (!invId) throw new Error(`Invitation not found for token: ${token}`)
			const invitation = this._invitations.get(invId)
			if (!invitation) throw new Error(`Invitation not found: ${invId}`)
			return { object: 'invitation', ...invitation }
		},

		acceptInvitation: async (invitationId: string): Promise<any> => {
			const invitation = this._invitations.get(invitationId)
			if (!invitation) throw new Error(`Invitation not found: ${invitationId}`)
			invitation.state = 'accepted'
			invitation.updatedAt = new Date().toISOString()
			return { object: 'invitation', ...invitation }
		},

		getInvitation: async (invitationId: string): Promise<any> => {
			const invitation = this._invitations.get(invitationId)
			if (!invitation) throw new Error(`Invitation not found: ${invitationId}`)
			return { object: 'invitation', ...invitation }
		},

		sendInvitation: async (options: any): Promise<any> => {
			// Check for existing pending invitation (matches actual WorkOS behavior)
			const existingPending = Array.from(this._invitations.values()).find(
				(inv) =>
					inv.email === options.email &&
					inv.organizationId === options.organizationId &&
					inv.state === 'pending',
			)
			if (existingPending) {
				// WorkOS returns GenericServerException with status 400 and specific message
				const error = new Error('Email already invited to organization.') as Error & {
					status: number
					name: string
					rawData: any
					requestID: string
				}
				error.status = 400
				error.name = 'GenericServerException'
				error.rawData = { message: 'Email already invited to organization.' }
				error.requestID = `req_${Date.now()}`
				throw error
			}
			const invitation = this.addInvitation({
				email: options.email,
				organizationId: options.organizationId,
			})
			return { object: 'invitation', ...invitation }
		},

		revokeInvitation: async (invitationId: string): Promise<any> => {
			const invitation = this._invitations.get(invitationId)
			if (!invitation) throw new Error(`Invitation not found: ${invitationId}`)
			invitation.state = 'revoked'
			invitation.updatedAt = new Date().toISOString()
			return { object: 'invitation', ...invitation }
		},

		listUsers: async (options: any): Promise<any> => {
			const results = Array.from(this._users.values()).filter((u) => {
				if (options.email && u.email?.toLowerCase() !== String(options.email).toLowerCase()) return false
				if (options.organizationId) {
					const hasMembership = Array.from(this._memberships.values()).some(
						(m) => m.userId === u.id && m.organizationId === options.organizationId,
					)
					if (!hasMembership) return false
				}
				return true
			})
			return this._createAutoPaginatable(results.map((u) => ({ object: 'user', ...u })))
		},

		updateOrganizationMembership: async (membershipId: string, options: any): Promise<any> => {
			const membership = this._memberships.get(membershipId)
			if (!membership) throw new Error(`Membership not found: ${membershipId}`)
			if (options.roleSlug) membership.role = { slug: options.roleSlug }
			membership.updatedAt = new Date().toISOString()
			return { object: 'organization_membership', ...membership }
		},

		deleteOrganizationMembership: async (membershipId: string): Promise<any> => {
			const membership = this._memberships.get(membershipId)
			if (!membership) throw new Error(`Membership not found: ${membershipId}`)
			this._memberships.delete(membershipId)
			return { object: 'organization_membership', ...membership }
		},

		deactivateOrganizationMembership: async (membershipId: string): Promise<any> => {
			const membership = this._memberships.get(membershipId)
			if (!membership) throw new Error(`Membership not found: ${membershipId}`)
			membership.status = 'inactive'
			membership.updatedAt = new Date().toISOString()
			return { object: 'organization_membership', ...membership }
		},

		reactivateOrganizationMembership: async (membershipId: string): Promise<any> => {
			const membership = this._memberships.get(membershipId)
			if (!membership) throw new Error(`Membership not found: ${membershipId}`)
			membership.status = 'active'
			membership.updatedAt = new Date().toISOString()
			return { object: 'organization_membership', ...membership }
		},

		authenticateWithRefreshToken: async (_payload: any): Promise<any> => {
			return {
				user: { id: 'mock-user' },
				accessToken: 'mock-access-token',
				refreshToken: 'mock-refresh-token',
			}
		},

		listOrganizationMemberships: async (options: any): Promise<any> => {
			const results = Array.from(this._memberships.values()).filter((m) => {
				if (options.userId && m.userId !== options.userId) return false
				if (options.organizationId && m.organizationId !== options.organizationId) return false
				const statuses = options.statuses ?? ['active']
				if (!statuses.includes(m.status)) return false
				return true
			})
			return this._createAutoPaginatable(
				results.map((m) => ({
					object: 'organization_membership',
					...m,
				})),
			)
		},

		getAuthorizationUrl: (options: any): string => {
			const params = new URLSearchParams({
				redirect_uri: options.redirectUri,
				client_id: options.clientId,
				...(options.provider && { provider: options.provider }),
				...(options.organizationId && { organization_id: options.organizationId }),
			})
			return `https://mock-workos.com/sso/authorize?${params.toString()}`
		},

		createOrganizationMembership: async (options: any): Promise<any> => {
			const membership = this.addMembership({
				userId: options.userId,
				organizationId: options.organizationId,
				role: { slug: options.roleSlug ?? 'member' },
			})
			return { object: 'organization_membership', ...membership }
		},
	}

	organizations: WorkosSdkAdapter['organizations'] = {
		getOrganization: async (organizationId: string): Promise<any> => {
			const org = this._organizations.get(organizationId)
			if (!org) throw new Error(`Organization not found: ${organizationId}`)
			return { object: 'organization', ...org }
		},

		createOrganization: async (options: any): Promise<any> => {
			const org = this.addOrganization({
				id: this.generateId('org'),
				name: options.name,
				externalId: options.externalId ?? null,
			})
			return { object: 'organization', ...org }
		},

		updateOrganization: async (options: any): Promise<any> => {
			const orgId = options.organization || options.organizationId
			const org = this._organizations.get(orgId)
			if (!org) throw new Error(`Organization not found: ${orgId}`)
			if (options.name) org.name = options.name
			if (options.externalId !== undefined) org.externalId = options.externalId
			if (options.stripeCustomerId !== undefined) org.stripeCustomerId = options.stripeCustomerId
			if (options.metadata) {
				org.metadata = { ...org.metadata, ...options.metadata }
			}
			org.updatedAt = new Date().toISOString()
			return { object: 'organization', ...org }
		},
	}

	organizationDomains: WorkosSdkAdapter['organizationDomains'] = {
		create: async (options) => {
			const organization = this._organizations.get(options.organizationId)
			if (!organization) throw new Error(`Organization not found: ${options.organizationId}`)

			const domain = { id: this.generateId('org_domain'), domain: options.domain, state: 'pending' as const }
			organization.domains.push(domain)
			organization.updatedAt = new Date().toISOString()

			return {
				object: 'organization_domain',
				id: domain.id,
				domain: domain.domain,
				state: OrganizationDomainState.Pending,
				organizationId: organization.id,
				verificationStrategy: OrganizationDomainVerificationStrategy.Dns,
				createdAt: organization.updatedAt,
				updatedAt: organization.updatedAt,
			}
		},
		delete: async (domainId) => {
			for (const organization of this._organizations.values()) {
				const domainIndex = organization.domains.findIndex((domain) => domain.id === domainId)
				if (domainIndex < 0) continue
				organization.domains.splice(domainIndex, 1)
				organization.updatedAt = new Date().toISOString()
				return
			}
			throw new Error(`Organization domain not found: ${domainId}`)
		},
	}

	adminPortal: WorkosSdkAdapter['adminPortal'] = {
		generateLink: async (options: any): Promise<any> => {
			return { link: `https://mock-workos.com/portal/${options.organization}/${options.intent}` }
		},
	}

	apiKeys: WorkosSdkAdapter['apiKeys'] = {
		createValidation: async () => {
			throw new Error('Mock WorkOS method not implemented: apiKeys.createValidation')
		},
		deleteApiKey: async () => {
			throw new Error('Mock WorkOS method not implemented: apiKeys.deleteApiKey')
		},
	}

	// ============ Helpers ============

	private _createAutoPaginatable<T>(data: T[]) {
		return {
			data,
			listMetadata: { before: null, after: null },
			autoPagination: async () => data,
		}
	}
}

/**
 * Default mock implementations that throw if called unexpectedly.
 * Override specific methods in tests as needed.
 */
export function createMockWorkosService(
	overrides?: Partial<{
		config: Partial<WorkosSdkAdapter['config']>
		countActiveOrganizationMemberships: WorkosSdkAdapter['countActiveOrganizationMemberships']
		countPendingInvitations: WorkosSdkAdapter['countPendingInvitations']
		verifyWebhook: WorkosSdkAdapter['verifyWebhook']
		getMembershipWebhookEvent: WorkosSdkAdapter['getMembershipWebhookEvent']
		userManagement: Partial<WorkosSdkAdapter['userManagement']>
		organizations: Partial<WorkosSdkAdapter['organizations']>
		organizationDomains: Partial<WorkosSdkAdapter['organizationDomains']>
		adminPortal: Partial<WorkosSdkAdapter['adminPortal']>
		apiKeys: Partial<WorkosSdkAdapter['apiKeys']>
	}>,
): WorkosSdkAdapter {
	// For async methods
	const notImplemented = (method: string) => async () => {
		throw new Error(`Mock WorkOS method not implemented: ${method}`)
	}

	// For synchronous methods
	const notImplementedSync = (method: string) => () => {
		throw new Error(`Mock WorkOS method not implemented: ${method}`)
	}

	return {
		countActiveOrganizationMemberships:
			overrides?.countActiveOrganizationMemberships ?? notImplemented('countActiveOrganizationMemberships'),
		countPendingInvitations: overrides?.countPendingInvitations ?? notImplemented('countPendingInvitations'),
		verifyWebhook: overrides?.verifyWebhook ?? notImplemented('verifyWebhook'),
		getMembershipWebhookEvent:
			overrides?.getMembershipWebhookEvent ??
			(() => {
				throw new Error('Mock WorkOS method not implemented: getMembershipWebhookEvent')
			}),
		config: {
			redirectUri: overrides?.config?.redirectUri ?? 'https://mock-redirect.example.com/callback',
			clientId: overrides?.config?.clientId ?? 'mock-client-id',
		},
		userManagement: {
			createUserApiKey:
				overrides?.userManagement?.createUserApiKey ?? notImplemented('userManagement.createUserApiKey'),
			listUserApiKeys:
				overrides?.userManagement?.listUserApiKeys ?? notImplemented('userManagement.listUserApiKeys'),
			getUser: overrides?.userManagement?.getUser ?? notImplemented('userManagement.getUser'),
			listInvitations:
				overrides?.userManagement?.listInvitations ?? notImplemented('userManagement.listInvitations'),
			findInvitationByToken:
				overrides?.userManagement?.findInvitationByToken ??
				notImplemented('userManagement.findInvitationByToken'),
			acceptInvitation:
				overrides?.userManagement?.acceptInvitation ?? notImplemented('userManagement.acceptInvitation'),
			listOrganizationMemberships:
				overrides?.userManagement?.listOrganizationMemberships ??
				notImplemented('userManagement.listOrganizationMemberships'),
			getAuthorizationUrl:
				overrides?.userManagement?.getAuthorizationUrl ??
				notImplementedSync('userManagement.getAuthorizationUrl'),
			createOrganizationMembership:
				overrides?.userManagement?.createOrganizationMembership ??
				notImplemented('userManagement.createOrganizationMembership'),
			getInvitation: overrides?.userManagement?.getInvitation ?? notImplemented('userManagement.getInvitation'),
			sendInvitation:
				overrides?.userManagement?.sendInvitation ?? notImplemented('userManagement.sendInvitation'),
			revokeInvitation:
				overrides?.userManagement?.revokeInvitation ?? notImplemented('userManagement.revokeInvitation'),
			listUsers: overrides?.userManagement?.listUsers ?? notImplemented('userManagement.listUsers'),
			updateOrganizationMembership:
				overrides?.userManagement?.updateOrganizationMembership ??
				notImplemented('userManagement.updateOrganizationMembership'),
			deleteOrganizationMembership:
				overrides?.userManagement?.deleteOrganizationMembership ??
				notImplemented('userManagement.deleteOrganizationMembership'),
			deactivateOrganizationMembership:
				overrides?.userManagement?.deactivateOrganizationMembership ??
				notImplemented('userManagement.deactivateOrganizationMembership'),
			reactivateOrganizationMembership:
				overrides?.userManagement?.reactivateOrganizationMembership ??
				notImplemented('userManagement.reactivateOrganizationMembership'),
			authenticateWithRefreshToken:
				overrides?.userManagement?.authenticateWithRefreshToken ??
				notImplemented('userManagement.authenticateWithRefreshToken'),
		},
		organizations: {
			getOrganization:
				overrides?.organizations?.getOrganization ?? notImplemented('organizations.getOrganization'),
			createOrganization:
				overrides?.organizations?.createOrganization ?? notImplemented('organizations.createOrganization'),
			updateOrganization:
				overrides?.organizations?.updateOrganization ?? notImplemented('organizations.updateOrganization'),
		},
		organizationDomains: {
			create: overrides?.organizationDomains?.create ?? notImplemented('organizationDomains.create'),
			delete: overrides?.organizationDomains?.delete ?? notImplemented('organizationDomains.delete'),
		},
		adminPortal: {
			generateLink: overrides?.adminPortal?.generateLink ?? notImplemented('adminPortal.generateLink'),
		},
		apiKeys: {
			createValidation: overrides?.apiKeys?.createValidation ?? notImplemented('apiKeys.createValidation'),
			deleteApiKey: overrides?.apiKeys?.deleteApiKey ?? notImplemented('apiKeys.deleteApiKey'),
		},
	}
}
