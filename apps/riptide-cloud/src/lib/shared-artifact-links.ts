import { appOrigin } from './app-links'

function localAppOrigin(): string {
	if (typeof window !== 'undefined' && window.location.hostname.startsWith('cloud.')) {
		const url = new URL(window.location.origin)
		url.hostname = `app.${url.hostname.slice('cloud.'.length)}`
		return url.origin
	}
	return 'http://localhost:3000'
}

export function sharedArtifactAppUrl(artifactId: string, shareKey?: string): string {
	const url = new URL(`/shared/artifacts/${encodeURIComponent(artifactId)}`, appOrigin() ?? localAppOrigin())
	if (shareKey) url.searchParams.set('key', shareKey)
	return url.toString()
}
