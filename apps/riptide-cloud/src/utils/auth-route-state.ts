import { defaultParseSearch } from '@tanstack/react-router'

import { logger } from '@/utils/logger'

const AUTH_RETURN_TO_STORAGE_KEY = 'riptide-cloud.auth.returnTo'
const AUTH_RETURN_TO_TTL_MS = 10 * 60 * 1000

export type AuthReturnToState = {
	pathname: string
	search: Record<string, unknown>
	hash: string
	createdAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isAuthReturnToState(value: unknown): value is AuthReturnToState {
	return (
		isRecord(value) &&
		typeof value.pathname === 'string' &&
		value.pathname.startsWith('/') &&
		!value.pathname.startsWith('//') &&
		isRecord(value.search) &&
		typeof value.hash === 'string' &&
		typeof value.createdAt === 'number'
	)
}

export function captureAuthReturnToState(pathname: string, search: unknown, hash: string): AuthReturnToState | null {
	if (pathname.startsWith('/auth/')) {
		logger.info('[AuthReturnTo] Skipping capture for auth route', { pathname })
		return null
	}

	const state = {
		pathname,
		search: isRecord(search) ? search : {},
		hash,
		createdAt: Date.now(),
	}

	logger.info('[AuthReturnTo] Captured return route', state)
	return state
}

export function captureAuthReturnToHref(href: string): AuthReturnToState | null {
	let url: URL
	try {
		url = new URL(href, window.location.origin)
	} catch {
		return null
	}

	if (url.origin !== window.location.origin) return null

	return captureAuthReturnToState(url.pathname, defaultParseSearch(url.search), url.hash.slice(1))
}

export function storeAuthReturnTo(state: AuthReturnToState | null): void {
	if (!state) return

	try {
		sessionStorage.setItem(AUTH_RETURN_TO_STORAGE_KEY, JSON.stringify(state))
		logger.info('[AuthReturnTo] Stored return route', state)
	} catch (error) {
		logger.warn('[AuthReturnTo] Failed to store return route', { error })
	}
}

export function consumeAuthReturnTo(): AuthReturnToState | null {
	let raw: string | null = null

	try {
		raw = sessionStorage.getItem(AUTH_RETURN_TO_STORAGE_KEY)
		sessionStorage.removeItem(AUTH_RETURN_TO_STORAGE_KEY)
	} catch (error) {
		logger.warn('[AuthReturnTo] Failed to read return route', { error })
		return null
	}

	if (!raw) return null

	try {
		const parsed: unknown = JSON.parse(raw)
		if (!isAuthReturnToState(parsed)) {
			logger.info('[AuthReturnTo] Ignoring invalid return route', { parsed })
			return null
		}

		if (Date.now() - parsed.createdAt > AUTH_RETURN_TO_TTL_MS) {
			logger.info('[AuthReturnTo] Ignoring expired return route', { parsed })
			return null
		}

		logger.info('[AuthReturnTo] Consumed return route', parsed)
		return parsed
	} catch (error) {
		logger.warn('[AuthReturnTo] Failed to parse return route', { error })
		return null
	}
}
