import type { DesktopDeepLink } from '@humanlayer/riptide-electron-rpc'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as Stream from 'effect/Stream'

import type { DeepLinkPlatformError } from './deep-link.errors'

export interface DeepLinkServiceShape {
	readonly initializePackagedProtocolClients: Effect.Effect<void, DeepLinkPlatformError>
	readonly enableWindowActivation: Effect.Effect<void>
	readonly takePending: Effect.Effect<DesktopDeepLink | null>
	// Accepted links buffer in the host queue until a consumer takes them, and
	// competing consumers each receive a link exactly once.
	readonly events: Stream.Stream<DesktopDeepLink>
	readonly windowActivationRequests: Stream.Stream<void>
}

export class DeepLinkService extends Context.Service<DeepLinkService, DeepLinkServiceShape>()('DeepLinkService') {}
