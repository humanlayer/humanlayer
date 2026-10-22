import type { UpdateEvent, UpdateInfo } from '@humanlayer/riptide-electron-rpc'

import {
	checkForElectronUpdate,
	downloadElectronUpdate,
	installAndRelaunchElectron,
} from '@/integrations/electron/updater'
import { checkForTauriUpdate, downloadTauriUpdate, installAndRelaunchTauri } from '@/integrations/tauri/updater'
import { isElectron, isTauri } from '@/lib/utils'

export type { UpdateEvent, UpdateInfo }

export async function checkForUpdate(): Promise<UpdateInfo | null> {
	if (isElectron()) return checkForElectronUpdate()
	if (isTauri()) return checkForTauriUpdate()
	return null
}

export async function downloadUpdate(onEvent: (event: UpdateEvent) => void): Promise<void> {
	if (isElectron()) return downloadElectronUpdate(onEvent)
	if (isTauri()) return downloadTauriUpdate(onEvent)
}

export async function installAndRelaunch(): Promise<void> {
	if (isElectron()) return installAndRelaunchElectron()
	if (isTauri()) return installAndRelaunchTauri()
}
