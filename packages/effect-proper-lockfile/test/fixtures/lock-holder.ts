import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { ProperLockfile, ProperLockfileLive } from '@humanlayer/effect-proper-lockfile'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'

const targetPath = process.argv[2]

if (targetPath === undefined) {
	throw new Error('A target path is required')
}

Effect.scoped(
	Effect.gen(function* () {
		const properLockfile = yield* ProperLockfile
		yield* properLockfile.acquire({
			path: targetPath,
			stale: '2 seconds',
			updateInterval: '1 second',
		})
		yield* Console.log('LOCK_READY')
		return yield* Effect.never
	}),
).pipe(Effect.provide(ProperLockfileLive), Effect.provide(NodeServices.layer), NodeRuntime.runMain)
