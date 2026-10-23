import type { DiscoveredGitRepository } from '@humanlayer/riptide-electron-rpc'

import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'

export const discoverGitRepositories = (directory: string): Promise<ReadonlyArray<DiscoveredGitRepository>> =>
	electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.DiscoverGitRepositories({ directory })))
