export const ARTIFACT_PUBLIC_PERMISSIONS = ['off', 'view', 'comment'] as const

export type ArtifactPublicPermission = (typeof ARTIFACT_PUBLIC_PERMISSIONS)[number]

export interface ArtifactPublicPermissionCompatibilityRow {
	share_enabled: boolean
	public_permission: ArtifactPublicPermission
}

export interface ArtifactPublicPermissionOrgPolicy {
	/** `organization_settings.enable_creating_publicly_shareable_links`; true when the org has no settings row. */
	publicLinksAllowed: boolean
}

/**
 * Resolves sharing state while legacy clients still write share_enabled.
 * A legacy enabled write can only grant view access; only an aligned new-client
 * write can grant comment access.
 *
 * The org policy is required so every reader denies public access while the org
 * has public links turned off, even if an artifact row still says it is shared.
 */
export function effectivePublicPermission(
	row: ArtifactPublicPermissionCompatibilityRow,
	org: ArtifactPublicPermissionOrgPolicy,
): ArtifactPublicPermission {
	if (!org.publicLinksAllowed) return 'off'
	if (!row.share_enabled) return 'off'
	return row.public_permission === 'comment' ? 'comment' : 'view'
}
