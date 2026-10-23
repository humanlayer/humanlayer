import * as Effect from 'effect/Effect'

import { Sentry } from '../../instrument'

interface SentryIdentityPayload {
	readonly userId: string | null
	readonly email?: string
	readonly organizationId?: string
	readonly organizationName?: string
}

export const setSentryIdentityHandler = Effect.fn('rpc.set_sentry_identity')(function* (
	payload: SentryIdentityPayload,
) {
	yield* Effect.sync(() => {
		if (payload.userId === null) {
			Sentry.setUser(null)
			Sentry.setContext('organization', null)
			return
		}
		Sentry.setUser({ id: payload.userId, email: payload.email })
		Sentry.setContext('organization', {
			id: payload.organizationId,
			name: payload.organizationName,
		})
	})
})
