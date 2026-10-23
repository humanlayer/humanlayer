import { useAuth } from '@workos-inc/authkit-react'
import { useCallback } from 'react'

import { logger } from '@/lib/logger'
import { openExternal } from '@/lib/url-opener'
import { isElectron, isTauri } from '@/lib/utils'

type BrowserAuthSignInOptions = {
	context?: string
	organizationId?: string
}

/**
 * Returns true if auth should open in system browser (Tauri Pro builds)
 */
export function shouldUseSystemBrowser(): boolean {
	return (isTauri() || isElectron()) && !import.meta.env.DEV
}

/**
 * Hook that provides auth functions that work correctly in both browser and Tauri Pro builds.
 *
 * In Tauri Pro builds:
 * - `signIn()` opens the system browser with the auth URL
 * - `switchOrganization()` opens the system browser with the org-specific auth URL
 * - Dashboard links use `openUrl()` instead of `<a>` tags
 *
 * In browser/non-Pro builds:
 * - Uses standard AuthKit functions (in-app redirects)
 */
export function useBrowserAuth() {
	const auth = useAuth()
	const { signIn: authKitSignIn, switchToOrganization: authKitSwitchOrg, getSignInUrl } = auth

	/**
	 * Sign in - opens system browser for Tauri Pro, in-app redirect otherwise
	 * Falls back to in-app AuthKit sign-in if browser opening fails
	 */
	const signIn = useCallback(
		async (options?: BrowserAuthSignInOptions) => {
			logger.info('[BrowserAuth] Starting sign-in', {
				organizationId: options?.organizationId,
				hasContext: !!options?.context,
				shouldUseSystemBrowser: shouldUseSystemBrowser(),
			})
			if (shouldUseSystemBrowser()) {
				try {
					const url = await getSignInUrl(options)
					logger.info('[BrowserAuth] Opening sign-in in system browser:', url)
					await openExternal(url)
				} catch (error) {
					logger.error('[BrowserAuth] Failed to open sign-in in browser, falling back to in-app:', error)
					// Fall back to in-app AuthKit sign-in
					await authKitSignIn(options)
				}
			} else {
				logger.info('[BrowserAuth] Redirecting in-app with AuthKit')
				await authKitSignIn(options)
			}
		},
		[authKitSignIn, getSignInUrl],
	)

	/**
	 * Switch organization - opens system browser for Tauri Pro, in-app redirect otherwise
	 *
	 * Note: WorkOS switchToOrganization internally does a redirect to the sign-in URL
	 * with the organizationId, so we replicate that behavior by calling getSignInUrl
	 * with the organizationId and opening in the browser.
	 *
	 * Falls back to in-app AuthKit switchToOrganization if browser opening fails.
	 */
	const switchOrganization = useCallback(
		async (options: { organizationId: string }) => {
			if (shouldUseSystemBrowser()) {
				try {
					const url = await getSignInUrl({ organizationId: options.organizationId })
					logger.info('[BrowserAuth] Opening org switch in system browser:', url)
					await openExternal(url)
				} catch (error) {
					logger.error('[BrowserAuth] Failed to open org switch in browser, falling back to in-app:', error)
					// Fall back to in-app AuthKit switchToOrganization
					await authKitSwitchOrg(options)
				}
			} else {
				await authKitSwitchOrg(options)
			}
		},
		[authKitSwitchOrg, getSignInUrl],
	)

	return {
		...auth,
		signIn,
		switchOrganization,
		openExternal,
		shouldUseSystemBrowser: shouldUseSystemBrowser(),
	}
}
