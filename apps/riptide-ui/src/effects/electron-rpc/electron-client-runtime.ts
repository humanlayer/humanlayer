import * as Effect from 'effect/Effect'
import * as ManagedRuntime from 'effect/ManagedRuntime'

import { isElectron } from '@/lib/utils'

import { ElectronRpcClientLive } from './electron-rpc-client.layer'
import { ElectronRpcClient } from './electron-rpc-client.service'

export type ElectronClientRuntimeServices = ElectronRpcClient
export type ElectronClientRuntime = ManagedRuntime.ManagedRuntime<ElectronClientRuntimeServices, never>

export const ElectronClientRuntimeLive = ElectronRpcClientLive
export const electronClientRuntime: ElectronClientRuntime = ManagedRuntime.make(ElectronClientRuntimeLive)

let initialized = false

export function initializeElectronClientRuntime(): void {
	if (initialized || !isElectron()) return
	initialized = true

	// Warm the lazy runtime before application code starts issuing RPCs. Dispose only once the
	// document is actually unloading: `beforeunload` can fire for navigation attempts that do not
	// destroy the renderer, which would leave the singleton permanently disposed.
	void electronClientRuntime.runPromise(Effect.asVoid(ElectronRpcClient))
	window.addEventListener('unload', () => void electronClientRuntime.dispose(), { once: true })
}
