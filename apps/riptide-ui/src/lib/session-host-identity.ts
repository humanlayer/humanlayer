export type SessionHostIdentitySource = {
	host_id?: string | null
	organization_id?: string | null
	created_by?: string | null
}

export type SessionHostRegistrationIdentity = {
	hostId: string
	organizationId: string
	userId: string
}

export function getSessionHostRegistrationIdentity(
	session: SessionHostIdentitySource | undefined,
): SessionHostRegistrationIdentity | undefined {
	if (!session?.host_id || !session.organization_id || !session.created_by) return undefined
	return {
		hostId: session.host_id,
		organizationId: session.organization_id,
		userId: session.created_by,
	}
}
