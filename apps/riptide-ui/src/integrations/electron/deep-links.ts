import type { DesktopDeepLink } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Stream from 'effect/Stream'

import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'
import { logger } from '@/lib/logger'

export function takePendingDeepLink(): Promise<DesktopDeepLink | null> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.TakePendingDeepLink()))
}

// One long-lived server-push subscription. If the stream ever fails or ends,
// resubscribe after a short pause; links stay in the host queue until a
// subscriber takes them, so nothing is lost in between.
export function subscribeToDeepLinks(callback: (link: DesktopDeepLink) => void) {
	return ElectronRpcClient.use((client) =>
		Effect.suspend(() =>
			client.DeepLinkEvents().pipe(Stream.runForEach((link) => Effect.sync(() => callback(link)))),
		).pipe(
			Effect.catch((error) =>
				Effect.sync(() => logger.warn('[DeepLink] Deep link stream failed, resubscribing:', error)),
			),
			Effect.andThen(Effect.sleep('1 second')),
			Effect.forever,
		),
	)
}

export async function onDeepLink(callback: (link: DesktopDeepLink) => void): Promise<() => void> {
	const fiber = electronClientRuntime.runFork(subscribeToDeepLinks(callback))
	return () => {
		electronClientRuntime.runFork(Fiber.interrupt(fiber))
	}
}
