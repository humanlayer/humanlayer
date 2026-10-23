/**
 * The riptide-cloud origin. Undefined in a build without VITE_PUBLIC_CLOUD_ORIGIN, where cloud
 * links are hidden or say why they can't open.
 */
export function getCloudOrigin(): string | undefined {
	return import.meta.env.VITE_PUBLIC_CLOUD_ORIGIN || undefined
}

/**
 * Generate the cloud URL for an artifact.
 */
export function getArtifactCloudUrl(artifactId: string): string | undefined {
	const baseUrl = getCloudOrigin()
	return baseUrl && `${baseUrl}/artifacts/${artifactId}`
}

/**
 * Generate the public share URL for an artifact.
 * Uses the Riptide UI browser origin, which owns the shared-artifact route.
 */
export function getArtifactShareUrl(artifactId: string, shareKey: string): string {
	const baseUrl = import.meta.env.VITE_PUBLIC_APP_ORIGIN || window.location.origin
	return `${baseUrl}/shared/artifacts/${artifactId}?key=${shareKey}`
}

export function getAuthenticatedArtifactUrl(taskId: string, artifactId: string): string {
	const baseUrl = import.meta.env.VITE_PUBLIC_APP_ORIGIN || window.location.origin
	const search = new URLSearchParams({ artifactId })
	return `${baseUrl}/tasks/${taskId}?${search.toString()}`
}

export function getArtifactSharingUrl(
	taskId: string,
	artifactId: string,
	permission: 'off' | 'view' | 'comment',
	shareKey: string | null,
): string | null {
	if (permission === 'off') return getAuthenticatedArtifactUrl(taskId, artifactId)
	return shareKey ? getArtifactShareUrl(artifactId, shareKey) : null
}

/**
 * Generate the cloud URL for organization settings.
 */
export function getOrgSettingsUrl(): string | undefined {
	const baseUrl = getCloudOrigin()
	return baseUrl && `${baseUrl}/settings`
}
