import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'

export function setZoom(zoomFactor: number): Promise<void> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.SetZoom({ zoomFactor })))
}
