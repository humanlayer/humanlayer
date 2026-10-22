import { Effect, Layer, Stream } from 'effect'

import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import { DaemonCollections } from '@/effects/services/daemon-collections/daemon-collections.service'
import logger from '@/logger'

import { makeProviderLoginHandler } from './provider-login.controller'
import { ProviderLogin } from './provider-login.service'

export const ProviderLoginLive = Layer.effect(
	ProviderLogin,
	Effect.gen(function* () {
		const api = yield* DaemonApi
		const collections = yield* DaemonCollections
		const handler = yield* makeProviderLoginHandler({
			update: (input) =>
				api.updateProviderLogin(input).pipe(
					Effect.asVoid,
					Effect.catch((error) =>
						Effect.sync(() =>
							logger.error(
								{ requestId: input.requestId, error },
								'Could not report provider login progress',
							),
						),
					),
				),
		})
		const run = collections.providerLoginChanges.pipe(Stream.mapEffect(handler.handle), Stream.runDrain)
		return { run }
	}),
)
