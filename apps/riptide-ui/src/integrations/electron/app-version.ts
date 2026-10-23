import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'

export function getAppVersion(): Promise<string> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.GetAppVersion()))
}
