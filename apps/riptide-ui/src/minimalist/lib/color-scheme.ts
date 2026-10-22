import { useSyncExternalStore } from 'react'

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
