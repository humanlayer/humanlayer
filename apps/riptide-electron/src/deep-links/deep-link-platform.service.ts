import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as Stream from 'effect/Stream'

import type { DeepLinkPlatformError } from './deep-link.errors'

export interface DeepLinkPlatformShape {
	readonly initialArguments: ReadonlyArray<string>
	readonly incomingArguments: Stream.Stream<ReadonlyArray<string>>
	readonly registerProtocolClient: (input: {
		readonly scheme: string
	}) => Effect.Effect<boolean, DeepLinkPlatformError>
	readonly ownsProtocol: (input: { readonly scheme: string }) => Effect.Effect<boolean, DeepLinkPlatformError>
	readonly focusMainWindow: Effect.Effect<void, DeepLinkPlatformError>
}

export class DeepLinkPlatform extends Context.Service<DeepLinkPlatform, DeepLinkPlatformShape>()('DeepLinkPlatform') {}
