import { env, type PublicEnvironment } from '@/env'

/**
 * Builds a `scheme://nav/...` URL that hands off to the desktop app.
 *
 * Mirrors `buildNavigationDeepLink` in riptide-ui (`src/domains/deep-links/handler.ts`),
 * whose `nav` host forwards any path straight to the router. The scheme map was previously
 * copied inline in each `/deep/*` route; the connect result screen would have made it a
 * third copy, so it lives here instead.
 */
const SCHEMES: Record<PublicEnvironment, string> = {
	prod: 'humanlayer',
	beta: 'riptide-beta',
	dev: 'riptide-dev',
	local: 'riptide-local',
}

export function buildDesktopDeepLink(path: string, search?: Record<string, string>): string {
	const scheme = SCHEMES[env.publicEnvironment]
	const query = search ? `?${new URLSearchParams(search).toString()}` : ''
	return `${scheme}://nav/${path.replace(/^\//, '')}${query}`
}

export function buildDesktopFocusDeepLink(): string {
	const scheme = SCHEMES[env.publicEnvironment]
	return `${scheme}://focus`
}
