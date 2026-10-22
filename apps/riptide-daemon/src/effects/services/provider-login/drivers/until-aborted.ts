import { Effect } from 'effect'

import type { ProviderLoginDriverContext } from '../provider-login.types'
import { ProviderLoginAborted } from '../provider-login.types'

/** Fails with `ProviderLoginAborted` when the request's signal aborts; race a login effect against it. */
export const untilAborted = (context: ProviderLoginDriverContext) =>
	Effect.callback<never, ProviderLoginAborted>((resume) => {
		const onAbort = () => resume(Effect.fail(new ProviderLoginAborted(context.signal.reason ?? 'cancelled')))
		if (context.signal.aborted) {
			onAbort()
			return
		}
		context.signal.addEventListener('abort', onAbort, { once: true })
		return Effect.sync(() => context.signal.removeEventListener('abort', onAbort))
	})
