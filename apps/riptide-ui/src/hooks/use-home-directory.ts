import { useState } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { getHomeDirectory } from '@/integrations/desktop/filesystem'
import { isElectron, isTauri } from '@/lib/utils'

/**
 * The local user's home directory in Tauri (desktop), null in web mode or
 * until resolved. Used to expand `~`-prefixed workspace paths client-side;
 * consumers must tolerate null (the daemon expands `~` at launch anyway).
 */
export function useHomeDirectory(): string | null {
	const [home, setHome] = useState<string | null>(null)

	useMountEffect(() => {
		if (!isElectron() && !isTauri()) return
		let cancelled = false
		getHomeDirectory()
			.then((dir) => {
				if (!cancelled && dir !== null) setHome(dir)
			})
			.catch(() => {
				// Web mode / plugin unavailable — leave null, `~` paths stay portable
			})
		return () => {
			cancelled = true
		}
	})

	return home
}
