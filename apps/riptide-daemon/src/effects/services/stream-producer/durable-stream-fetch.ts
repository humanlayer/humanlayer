import { Config, Context, Effect, Layer, Redacted } from 'effect'

export class DurableStreamFetch extends Context.Service<
	DurableStreamFetch,
	{
		readonly fetch: typeof fetch
	}
>()('DurableStreamFetch') {}

export const DurableStreamFetchLive = Layer.effect(
	DurableStreamFetch,
	Effect.gen(function* () {
		const daemonToken = yield* Config.Redacted('RIPTIDE_DAEMON_TOKEN')

		const fetchWithDaemonAuthorization = Object.assign(
			async (...args: Parameters<typeof fetch>) => {
				const [input, init] = args
				const headers = new Headers(init?.headers)
				headers.set('x-daemon-authorization', Redacted.value(daemonToken))
				return fetch(input, { ...init, headers })
			},
			{
				preconnect: (...args: Parameters<typeof fetch.preconnect>) => {
					fetch.preconnect?.(...args)
				},
			},
		) satisfies typeof fetch

		return { fetch: fetchWithDaemonAuthorization }
	}),
)
