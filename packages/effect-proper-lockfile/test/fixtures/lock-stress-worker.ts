import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { ProperLockfile, ProperLockfileLive } from '@humanlayer/effect-proper-lockfile'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'

const targetPath = process.argv[2]
const guardPath = process.argv[3]
const iterations = Number(process.argv[4] ?? '25')

if (targetPath === undefined || guardPath === undefined) {
	throw new Error('Target and guard paths are required')
}

const enterCriticalSection = Effect.fn('proper_lockfile_stress.enter_critical_section')(function* () {
	const fileSystem = yield* FileSystem.FileSystem
	yield* Effect.acquireUseRelease(
		fileSystem.makeDirectory(guardPath),
		() => Effect.sleep('2 millis'),
		() => fileSystem.remove(guardPath, { recursive: true, force: true }).pipe(Effect.ignore),
	)
})

Effect.gen(function* () {
	const properLockfile = yield* ProperLockfile
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		yield* Effect.scoped(
			Effect.gen(function* () {
				yield* properLockfile.acquire({
					path: targetPath,
					retries: 1_000,
					retryDelay: '2 millis',
				})
				yield* enterCriticalSection()
			}),
		)
	}
}).pipe(Effect.provide(ProperLockfileLive), Effect.provide(NodeServices.layer), NodeRuntime.runMain)
