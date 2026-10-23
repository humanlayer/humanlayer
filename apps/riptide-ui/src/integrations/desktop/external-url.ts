import { openUrl } from '@tauri-apps/plugin-opener'

import { openExternalUrl as openExternalUrlInElectron } from '@/integrations/electron/external-url'
import { isElectron, isTauri } from '@/lib/utils'

export async function openExternalUrl(url: string): Promise<void> {
	if (isElectron()) return openExternalUrlInElectron(url)
	if (isTauri()) return openUrl(url)
	window.open(url, '_blank', 'noopener,noreferrer')
}
