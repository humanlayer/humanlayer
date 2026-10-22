import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Stream from 'effect/Stream'

import { DeepLinkService } from '../src/deep-links/deep-link-service'

export const deepLinkServiceTestLayer = Layer.succeed(
	DeepLinkService,
	DeepLinkService.of({
		initializePackagedProtocolClients: Effect.void,
		enableWindowActivation: Effect.void,
		takePending: Effect.succeed(null),
		events: Stream.empty,
		windowActivationRequests: Stream.empty,
	}),
)
