import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'

export function openExternalUrl(url: string): Promise<void> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.OpenExternalUrl({ url })))
}
