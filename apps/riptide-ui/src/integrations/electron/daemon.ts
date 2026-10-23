import type { DaemonLaunchResult, DaemonLifecycleEvent, DaemonSyncMode } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Stream from 'effect/Stream'

import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'
import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'
import { riptideApiOrigin } from '@/orpc/client'

export function startDaemon(
	token: string,
	userId: string,
	organizationId: string,
	syncMode: DaemonSyncMode,
	verifiedClaudePath: string | null,
): Promise<DaemonLaunchResult> {
	// Pass the origins this renderer is using so the daemon targets the same
	// backend that minted its token, instead of whatever origin was baked into
	// the daemon binary at build time.
	return electronClientRuntime.runPromise(
		ElectronRpcClient.use((client) =>
			client.StartDaemon({
				token,
				userId,
				organizationId,
				syncMode,
				apiOrigin: riptideApiOrigin,
				syncOrigin: VITE_PUBLIC_SYNC_ORIGIN,
				verifiedClaudePath,
			}),
		),
	)
}

export function stopDaemon(userId: string, organizationId: string): Promise<void> {
	return electronClientRuntime.runPromise(
		ElectronRpcClient.use((client) => client.StopDaemon({ userId, organizationId })),
	)
}

export function setDaemonManagement(enabled: boolean): Promise<void> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.SetDaemonManagement({ enabled })))
}

export function isDaemonRunning(userId: string, organizationId: string): Promise<boolean> {
	return electronClientRuntime.runPromise(
		ElectronRpcClient.use((client) => client.IsDaemonRunning({ userId, organizationId })),
	)
}

export async function onDaemonLifecycleEvent(callback: (event: DaemonLifecycleEvent) => void): Promise<() => void> {
	const fiber = electronClientRuntime.runFork(
		Effect.gen(function* () {
			const client = yield* ElectronRpcClient
			yield* client.DaemonLifecycleEvents().pipe(Stream.runForEach((event) => Effect.sync(() => callback(event))))
		}),
	)
	return () => {
		electronClientRuntime.runFork(Fiber.interrupt(fiber))
	}
}
