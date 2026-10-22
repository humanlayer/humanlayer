import { useState } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { getAppVersion } from '@/integrations/desktop/app-version'

let cachedVersion: string | null = null

export function useAppVersion(): string | null {
	const [version, setVersion] = useState<string | null>(cachedVersion)

	useMountEffect(() => {
		if (cachedVersion) return
		void getAppVersion().then((value) => {
			cachedVersion = value
			setVersion(value)
		})
	})

	return version
}
