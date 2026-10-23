import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { isTauri } from '@/lib/utils'

/**
 * Browser-to-native handoff: rebuilds the current route as a custom-scheme URL so
 * the native app opens the same page. The route's raw query string is forwarded
 * opaquely — the hook never parses
 * individual params, so `artifactId` / `comment` / `fullscreen` and future fields
 * all survive the hop. The native deep-link handler passes the intent params to
 * router navigation and consumes the browser-only `deep` flag.
 */
export function useDeepLinkHandoff(path: string, deep: boolean | undefined): void {
	const navigate = useNavigate()
	const { user } = useAuth()
	const attemptedTargetRef = useRef<string | null>(null)
	const rawSearch = window.location.search

	useEffect(() => {
		if (!deep) return
		if (isTauri()) return
		if (!user?.id) return
		const target = `${path}${rawSearch}`
		if (attemptedTargetRef.current === target) return

		attemptedTargetRef.current = target
		const scheme = import.meta.env.VITE_PUBLIC_DEEP_LINK_SCHEME || 'riptide'
		toast.info('Opening in native app...', { duration: 3000 })
		window.location.href = `${scheme}://${target}`

		navigate({
			search: ((prev: Record<string, unknown>) => ({ ...prev, deep: undefined })) as never,
			replace: true,
		})
	}, [deep, path, rawSearch, navigate, user?.id])
}
