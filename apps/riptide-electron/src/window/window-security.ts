function isDevstackNavigation(target: URL, renderer: URL): boolean {
	if (target.protocol !== 'https:' || renderer.protocol !== 'https:') return false
	if (!renderer.hostname.endsWith('.localhost')) return false
	const firstLabelEnd = renderer.hostname.indexOf('.')
	if (firstLabelEnd < 1) return false
	const stackDomain = renderer.hostname.slice(firstLabelEnd + 1)
	return target.hostname === stackDomain || target.hostname.endsWith(`.${stackDomain}`)
}

function isLocalRenderer(renderer: URL): boolean {
	return (
		(renderer.protocol === 'http:' || renderer.protocol === 'https:') &&
		(renderer.hostname === 'localhost' || renderer.hostname.endsWith('.localhost'))
	)
}

function isWorkOsSignInNavigation(target: URL, renderer: URL): boolean {
	if (!isLocalRenderer(renderer) || target.protocol !== 'https:') return false
	if (target.hostname === 'api.workos.com') return target.pathname === '/user_management/authorize'
	return target.hostname === 'authkit.app' || target.hostname.endsWith('.authkit.app')
}

// Node's URL reports origin 'null' for custom schemes, so an origin comparison
// would treat every custom-scheme URL as same-origin. Compare protocol and host
// instead; for http(s) this matches origin semantics because host includes the
// port.
function isSameSite(target: URL, renderer: URL): boolean {
	return target.protocol === renderer.protocol && target.host === renderer.host
}

const allowedRendererPermissions = new Set([
	'clipboard-read',
	'clipboard-sanitized-write',
	'notifications',
	'media',
	'fullscreen',
	'openExternal',
	'persistent-storage',
])

export function rendererPermissionPolicy(permission: string, requestingUrl: string, rendererUrl: string): boolean {
	if (!allowedRendererPermissions.has(permission)) return false

	try {
		return isSameSite(new URL(requestingUrl), new URL(rendererUrl))
	} catch {
		return false
	}
}

export function navigationPolicy(targetUrl: string, rendererUrl: string): 'allow' | 'external' | 'deny' {
	try {
		const target = new URL(targetUrl)
		const renderer = new URL(rendererUrl)
		if (
			isSameSite(target, renderer) ||
			isDevstackNavigation(target, renderer) ||
			isWorkOsSignInNavigation(target, renderer)
		)
			return 'allow'
		if (target.protocol === 'http:' || target.protocol === 'https:') return 'external'
		return 'deny'
	} catch {
		return 'deny'
	}
}
