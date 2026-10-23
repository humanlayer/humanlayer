import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'

export interface ElectronSentryIdentity {
	readonly userId: string | null
	readonly email?: string
	readonly organizationId?: string
	readonly organizationName?: string
}

export function setElectronSentryIdentity(identity: ElectronSentryIdentity): Promise<void> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.SetSentryIdentity(identity)))
}
