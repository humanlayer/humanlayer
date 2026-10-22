import type { OpenInEditorPayload } from '@humanlayer/riptide-electron-rpc'

import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'

export function openInEditor(input: OpenInEditorPayload): Promise<void> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.OpenInEditor(input)))
}
