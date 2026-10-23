import type { DiscoveredGitRepository } from '@humanlayer/riptide-electron-rpc'
import { invoke } from '@tauri-apps/api/core'

import { isTauri } from '@/lib/utils'

export async function discoverGitRepositories(directory: string): Promise<ReadonlyArray<DiscoveredGitRepository>> {
	if (!isTauri()) return []
	return invoke<ReadonlyArray<DiscoveredGitRepository>>('discover_git_repositories', { directory })
}
