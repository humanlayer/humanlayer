import { useSyncExternalStore } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { setWindowAppearance } from '@/integrations/desktop/theme'

import { useUi } from './ui-state'

function subscribeScheme(onChange: () => void) {
	const media = matchMedia('(prefers-color-scheme: dark)')
	media.addEventListener('change', onChange)
	return () => media.removeEventListener('change', onChange)
}

export function useMinimalistDark(): boolean {
	const { theme } = useUi()
	const systemDark = useSyncExternalStore(
		subscribeScheme,
		() => matchMedia('(prefers-color-scheme: dark)').matches,
		() => false,
	)
	return theme === 'dark' || (theme === 'system' && systemDark)
}

/**
 * Hands the preference to the desktop window when the frame mounts; `setTheme` sends later changes.
 * The window decides what prefers-color-scheme reports, so the preference goes to it as is. Sending a
 * resolved light or dark for System would pin the media query, and System would stop following the OS.
 */
export function useWindowAppearance(): void {
	const { theme } = useUi()
	useMountEffect(() => {
		void setWindowAppearance(theme)
	})
}
