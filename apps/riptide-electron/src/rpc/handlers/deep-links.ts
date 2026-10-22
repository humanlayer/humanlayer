import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'

import { DeepLinkService } from '../../deep-links/deep-link-service'

export const takePendingDeepLinkHandler = Effect.fn('rpc.take_pending_deep_link')(function* () {
	const deepLinks = yield* DeepLinkService
	return yield* deepLinks.takePending
})

// Returns the stream itself so links leave the host queue only as they are
// written to the port; an intermediate queue would buffer links into memory
// that a dying connection discards.
export const deepLinkEventsHandler = () =>
	Stream.unwrap(
		Effect.gen(function* () {
			const deepLinks = yield* DeepLinkService
			return deepLinks.events
		}),
	)
