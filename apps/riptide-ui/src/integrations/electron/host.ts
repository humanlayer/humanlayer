import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'

export function getHostId(): Promise<string> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.GetHostId()))
}
