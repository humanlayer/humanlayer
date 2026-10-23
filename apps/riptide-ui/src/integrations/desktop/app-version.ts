import { getVersion as getTauriVersion } from '@tauri-apps/api/app'

import { getAppVersion as getElectronAppVersion } from '@/integrations/electron/app-version'
import { isElectron, isTauri } from '@/lib/utils'

export function getAppVersion(): Promise<string | null> {
	if (isElectron()) return getElectronAppVersion()
	if (isTauri()) return getTauriVersion()
	return Promise.resolve(null)
}
