import type { HostLogLevel } from '@humanlayer/riptide-electron-rpc'

import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'

export function writeHostLog(input: { readonly level: HostLogLevel; readonly message: string }): Promise<void> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.WriteHostLog(input)))
}

export function getLogDirectory(): Promise<string> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.GetLogDirectory()))
}

export function getCurrentLogFiles(): Promise<ReadonlyArray<string>> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.GetCurrentLogFiles()))
}
