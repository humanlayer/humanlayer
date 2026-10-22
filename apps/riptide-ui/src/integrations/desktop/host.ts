import { getHostId as getElectronHostId } from '@/integrations/electron/host'
import { getHostId as getTauriHostId } from '@/integrations/tauri/daemon'
import { isElectron, isTauri } from '@/lib/utils'

export async function getHostId(): Promise<string | null> {
	if (isElectron()) return getElectronHostId()
	if (isTauri()) return getTauriHostId()
	return null
}
