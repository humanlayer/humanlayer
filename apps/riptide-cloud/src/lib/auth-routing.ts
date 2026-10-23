const PUBLIC_ROUTE_PREFIXES = ['/auth/', '/shared/', '/connect/'] as const

/** Routes that can render without a HumanLayer browser session. */
export function isPublicRoute(pathname: string): boolean {
	return PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}
