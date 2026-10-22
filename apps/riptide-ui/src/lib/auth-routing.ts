const SHARED_ARTIFACT_ROUTE_PREFIX = '/shared/artifacts/'

export function isSharedArtifactRoute(pathname: string): boolean {
	return pathname.startsWith(SHARED_ARTIFACT_ROUTE_PREFIX)
}

export function isPublicBrowserRoute(pathname: string): boolean {
	return pathname === '/auth/signin' || pathname === '/auth/signout' || isSharedArtifactRoute(pathname)
}

export function providerModeForPath(pathname: string): 'shared' | 'authenticated' {
	return isSharedArtifactRoute(pathname) ? 'shared' : 'authenticated'
}

export function authenticatedArtifactDestination(taskId: string, artifactId: string) {
	return {
		to: '/tasks/$taskId' as const,
		params: { taskId },
		search: { artifactId },
		replace: true,
	}
}
