import { Effect, Queue } from 'effect'

import { SelfUpdater } from './self-update.service'

/** Hands every requested version to the updater without waiting, so a duplicate is dropped while an update runs. */
export const runRequestedSelfUpdates = (requestedVersions: Queue.Dequeue<string>) =>
	Effect.gen(function* () {
		const selfUpdater = yield* SelfUpdater
		return yield* Queue.take(requestedVersions).pipe(
			Effect.flatMap((version) => Effect.forkChild(selfUpdater.requestUpdate(version))),
			Effect.forever,
		)
	})
