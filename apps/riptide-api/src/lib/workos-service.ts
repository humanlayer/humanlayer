import { WorkOS } from '@workos-inc/node'

// Extract method types from SDK
type UserMgmt = WorkOS['userManagement']

export type WorkosEvent = {
	id: string
	event: string
	data: Record<string, unknown>
	createdAt?: string
	context?: Record<string, unknown>
}

export type WorkosWebhookMembershipEvent = {
	eventId: string
	eventType: 'organization_membership.created' | 'organization_membership.updated' | 'organization_membership.deleted'
	workosOrganizationId: string
	userId: string
}

/**
 * WorkOS configuration required for OAuth flows.
 */
export interface IWorkosConfig {
	redirectUri: string
	clientId: string
}

/**
 * Interface containing only the WorkOS methods used by route handlers.
 * Enables mocking in tests without requiring full SDK implementation.
 */
export interface WorkosSdkAdapter {
	config: IWorkosConfig
	countActiveOrganizationMemberships(workosOrganizationId: string): Promise<number>
	countPendingInvitations(input: { workosOrganizationId: string }): Promise<number>
	verifyWebhook(payload: string, signature: string): Promise<WorkosEvent>
	getMembershipWebhookEvent(event: WorkosEvent): WorkosWebhookMembershipEvent | null
	userManagement: {
		createUserApiKey: UserMgmt['createUserApiKey']
		listUserApiKeys: UserMgmt['listUserApiKeys']
		getUser: UserMgmt['getUser']
		listUsers: UserMgmt['listUsers']
		listInvitations: UserMgmt['listInvitations']
		findInvitationByToken: UserMgmt['findInvitationByToken']
		acceptInvitation: UserMgmt['acceptInvitation']
		listOrganizationMemberships: UserMgmt['listOrganizationMemberships']
		getAuthorizationUrl: UserMgmt['getAuthorizationUrl']
		createOrganizationMembership: UserMgmt['createOrganizationMembership']
		authenticateWithRefreshToken: UserMgmt['authenticateWithRefreshToken']
		getInvitation: UserMgmt['getInvitation']
		sendInvitation: UserMgmt['sendInvitation']
		revokeInvitation: UserMgmt['revokeInvitation']
		updateOrganizationMembership: UserMgmt['updateOrganizationMembership']
		deleteOrganizationMembership: UserMgmt['deleteOrganizationMembership']
		deactivateOrganizationMembership: UserMgmt['deactivateOrganizationMembership']
		reactivateOrganizationMembership: UserMgmt['reactivateOrganizationMembership']
	}
	organizations: {
		getOrganization: WorkOS['organizations']['getOrganization']
		createOrganization: WorkOS['organizations']['createOrganization']
		updateOrganization: WorkOS['organizations']['updateOrganization']
	}
	organizationDomains: {
		create: WorkOS['organizationDomains']['createOrganizationDomain']
		delete: WorkOS['organizationDomains']['deleteOrganizationDomain']
	}
	adminPortal: {
		generateLink: WorkOS['adminPortal']['generateLink']
	}
	apiKeys: {
		createValidation: WorkOS['apiKeys']['createValidation']
		deleteApiKey: WorkOS['apiKeys']['deleteApiKey']
	}
}

/**
 * Production implementation that wraps the WorkOS SDK.
 * Delegates all calls to the underlying client.
 */
export class WorkosSdkAdapterLive implements WorkosSdkAdapter {
	private client: WorkOS
	public readonly config: IWorkosConfig

	constructor(
		apiKey: string,
		clientId: string,
		redirectUri: string,
		private readonly webhookSecret?: string,
	) {
		this.client = new WorkOS(apiKey)
		this.config = { clientId, redirectUri }
	}

	async countActiveOrganizationMemberships(workosOrganizationId: string): Promise<number> {
		const memberships = await this.client.userManagement.listOrganizationMemberships({
			organizationId: workosOrganizationId,
			statuses: ['active'],
		})
		const activeMemberships = await memberships.autoPagination()
		return Math.max(activeMemberships.length, 1)
	}

	async countPendingInvitations(input: { workosOrganizationId: string }): Promise<number> {
		const invitations = await this.client.userManagement.listInvitations({
			organizationId: input.workosOrganizationId,
		})
		const allInvitations = await invitations.autoPagination()
		return allInvitations.filter((invitation) => invitation.state === 'pending').length
	}

	async verifyWebhook(payload: string, signature: string): Promise<WorkosEvent> {
		if (!this.webhookSecret) {
			throw new Error('WorkOS webhook secret is not configured')
		}

		return (await this.client.webhooks.constructEvent({
			payload: JSON.parse(payload),
			sigHeader: signature,
			secret: this.webhookSecret,
		})) as WorkosEvent
	}

	getMembershipWebhookEvent(event: WorkosEvent): WorkosWebhookMembershipEvent | null {
		if (!isMembershipWebhookEvent(event)) {
			return null
		}

		return {
			eventId: event.id,
			eventType: event.event,
			workosOrganizationId: String(event.data.organizationId),
			userId: String(event.data.userId),
		}
	}

	get userManagement() {
		return this.client.userManagement
	}

	get organizations() {
		return this.client.organizations
	}

	get organizationDomains() {
		return {
			create: this.client.organizationDomains.createOrganizationDomain.bind(this.client.organizationDomains),
			delete: this.client.organizationDomains.deleteOrganizationDomain.bind(this.client.organizationDomains),
		}
	}

	get adminPortal() {
		return this.client.adminPortal
	}

	get apiKeys() {
		return this.client.apiKeys
	}
}

function isMembershipWebhookEvent(event: WorkosEvent): event is WorkosEvent & {
	event: WorkosWebhookMembershipEvent['eventType']
	data: { organizationId: string }
} {
	return (
		event.event === 'organization_membership.created' ||
		event.event === 'organization_membership.updated' ||
		event.event === 'organization_membership.deleted'
	)
}
