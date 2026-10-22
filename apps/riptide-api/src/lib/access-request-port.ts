/**
 * Shared I/O types for the access-request service.
 *
 * The Effect-based implementation lives in `effects/services/access-request/access-request.service.ts` and is
 * exposed to procedures and the WorkOS webhook through `AccessRequestService` on the shared `appRuntime`. These
 * input/output types remain the contract-facing shapes consumed by the service and its DB helpers
 * (`access-request.service.ts`, `access-request-db.ts`).
 */
export type CreateAccessRequestInput = {
	artifactId: string
	requesterEmail: string
	requesterUserId: string | null
}

export type CreateAccessRequestOutput = {
	accessRequestId: string
	/**
	 * True when the requester already has a pending WorkOS invitation, so admins
	 * were NOT re-notified. The UI uses this to show a "check your email" screen
	 * instead of the standard pending screen.
	 */
	alreadyInvited: boolean
}

export type SendInviteAndResolveRequestsInput = {
	requesterEmail: string
	organizationId: string
	workosOrganizationId: string
	actingAdminUserId: string
	roleSlug?: string
	expiresInDays?: number
}

export type BackfillRequesterUserIdInput = {
	email: string
	userId: string
}

export type ArchiveAccessRequestInput = {
	accessRequestId: string
	organizationId: string
	archivedByUserId: string
}
