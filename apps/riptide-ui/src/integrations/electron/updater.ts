import type { UpdateEvent, UpdateInfo } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Stream from 'effect/Stream'

import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'

export function checkForElectronUpdate(): Promise<UpdateInfo | null> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.CheckForUpdate()))
}

export async function downloadElectronUpdate(onEvent: (event: UpdateEvent) => void): Promise<void> {
	// Subscribe to progress events before starting the download so we don't
	// miss early events. The subscription runs in a forked fiber; we clean it
	// up once the download RPC settles.
	const fiber = electronClientRuntime.runFork(
		Effect.gen(function* () {
			const client = yield* ElectronRpcClient
			yield* client.UpdateDownloadProgress().pipe(Stream.runForEach((event) => Effect.sync(() => onEvent(event))))
		}),
	)

	try {
		await electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.DownloadUpdate()))
	} finally {
		electronClientRuntime.runFork(Fiber.interrupt(fiber))
	}
}

export async function installAndRelaunchElectron(): Promise<void> {
	await electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.QuitAndInstall()))
}
