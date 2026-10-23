import type { DesktopDeepLink } from '@humanlayer/riptide-electron-rpc'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'

import type { ElectronConfig } from '../config/electron-config'
import { Sentry } from '../instrument'
import { DeepLinkPlatform } from './deep-link-platform.service'
import { DeepLinkService } from './deep-link-service'

function deepLinksFromArguments(
	arguments_: ReadonlyArray<string>,
	schemes: ReadonlyArray<string>,
): ReadonlyArray<DesktopDeepLink> {
	return arguments_.flatMap((argument) => {
		try {
			const url = new URL(argument)
			return schemes.includes(url.protocol.slice(0, -1)) ? [{ url: url.toString() }] : []
		} catch {
			return []
		}
	})
}

export function makeDeepLinkServiceLive(config: ElectronConfig) {
	return Layer.effect(
		DeepLinkService,
		Effect.gen(function* () {
			const platform = yield* DeepLinkPlatform
			const protocolSchemes = config.protocolSchemes
			const acceptedLinks = yield* Queue.unbounded<DesktopDeepLink>()
			const windowActivationRequests = yield* Queue.unbounded<void>()
			const windowActivationEnabled = yield* Deferred.make<void>()

			const acceptArguments = Effect.fn('deep_link_service.accept_arguments')(function* (
				arguments_: ReadonlyArray<string>,
			) {
				for (const link of deepLinksFromArguments(arguments_, protocolSchemes)) {
					yield* Queue.offer(windowActivationRequests, undefined)
					yield* platform.focusMainWindow.pipe(
						Effect.tapError((e) => Effect.logError(e)),
						Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
						Effect.catchTag('DeepLinkPlatformError', () => Effect.void),
					)
					yield* Queue.offer(acceptedLinks, link)
					yield* Effect.logInfo('Accepted desktop deep link').pipe(
						Effect.annotateLogs({ scheme: new URL(link.url).protocol.slice(0, -1) }),
					)
				}
			})

			yield* acceptArguments(platform.initialArguments)
			yield* platform.incomingArguments.pipe(Stream.runForEach(acceptArguments), Effect.forkScoped)

			const initializePackagedProtocolClients = config.isPackaged
				? Effect.forEach(
						protocolSchemes,
						(scheme) =>
							platform.registerProtocolClient({ scheme }).pipe(
								Effect.flatMap((registrationAccepted) =>
									platform.ownsProtocol({ scheme }).pipe(
										Effect.tap((ownsProtocol) =>
											Effect.logInfo('Electron protocol ownership verified').pipe(
												Effect.annotateLogs({
													scheme,
													registration_accepted: registrationAccepted,
													owns_protocol: ownsProtocol,
												}),
											),
										),
									),
								),
								Effect.tapError((e) => Effect.logError(e)),
								Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
							),
						{ discard: true },
					).pipe(Effect.withSpan('deep_link_service.initialize_packaged_protocol_clients'))
				: Effect.void

			return DeepLinkService.of({
				initializePackagedProtocolClients,
				enableWindowActivation: Deferred.succeed(windowActivationEnabled, undefined).pipe(Effect.asVoid),
				takePending: Queue.poll(acceptedLinks).pipe(
					Effect.map(Option.getOrNull),
					Effect.withSpan('deep_link_service.take_pending'),
				),
				events: Stream.fromEffectRepeat(Queue.take(acceptedLinks)),
				windowActivationRequests: Stream.fromEffect(Deferred.await(windowActivationEnabled)).pipe(
					Stream.flatMap(() => Stream.fromEffectRepeat(Queue.take(windowActivationRequests))),
				),
			})
		}),
	)
}
