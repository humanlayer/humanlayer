import type { DiscoveredGitRepository } from '@humanlayer/riptide-electron-rpc'

import { resolveLocalPath } from '@/integrations/desktop/filesystem'
import * as electronDiscovery from '@/integrations/electron/repository-discovery'
import * as tauriDiscovery from '@/integrations/tauri/repository-discovery'
import { isElectron, isTauri } from '@/lib/utils'

export async function discoverGitRepositories(directory: string): Promise<ReadonlyArray<DiscoveredGitRepository>> {
	const resolved = await resolveLocalPath(directory)
	if (isElectron()) return electronDiscovery.discoverGitRepositories(resolved)
	if (isTauri()) return tauriDiscovery.discoverGitRepositories(resolved)
	return []
}
