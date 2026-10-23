import { pickDirectory as pickElectronDirectory } from '@/integrations/electron/filesystem'
import { pickExistingDirectory as pickTauriDirectory } from '@/integrations/tauri/directory-picker'
import { isElectron, isTauri } from '@/lib/utils'

export async function pickExistingDirectory(): Promise<string | null> {
	if (isElectron()) return pickElectronDirectory()
	if (isTauri()) return pickTauriDirectory()
	return null
}
