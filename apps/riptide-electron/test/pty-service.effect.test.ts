import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'

import { PtyService } from '../src/pty/pty-service'
import { PtyServiceLive } from '../src/pty/pty-service.layer'

const PtyTestLive = PtyServiceLive.pipe(Layer.provide(NodeServices.layer))
const nodeMajorVersion = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
const nodePtyUnsupported = process.versions.electron === undefined && nodeMajorVersion >= 24
const testName = 'streams input, detaches with replay, resizes, lists, and kills a PTY'

const outputText = (event: { readonly event: string; readonly data: unknown }): string => {
	if (event.event !== 'output') return ''
	const data = event.data
	if (typeof data !== 'object' || data === null || !('data' in data) || !Array.isArray(data.data)) return ''
	return new TextDecoder().decode(Uint8Array.from(data.data))
}

describe('PtyService', () => {
	if (nodePtyUnsupported) {
		it.skip(testName, () => {})
		return
	}

	it.live(testName, () =>
		Effect.scoped(
			Effect.gen(function* () {
				const service = yield* PtyService
				const ptyId = yield* service.create({ cwd: '/tmp' })
				expect(yield* service.list).toContain(ptyId)
				const attachmentStarted = yield* service.attach({ ptyId }).pipe(Stream.runHead)
				expect(attachmentStarted).toMatchObject({ _tag: 'Some', value: { event: 'attached' } })
				const missingAttachment = yield* Effect.flip(
					service.attach({ ptyId: 'missing-pty' }).pipe(Stream.runDrain),
				)
				expect(missingAttachment._tag).toBe('PtyNotFoundError')

				const events = yield* Queue.unbounded<{
					readonly event: 'output' | 'exit'
					readonly data: { readonly data: ReadonlyArray<number> } | { readonly code: number | null }
				}>()
				const attachedFiber = yield* service.attach({ ptyId }).pipe(
					Stream.filter((event) => event.event !== 'attached'),
					Stream.runForEach((event) => Queue.offer(events, event)),
					Effect.forkChild({ startImmediately: true }),
				)
				yield* service.write({ ptyId, data: Array.from(new TextEncoder().encode('echo attached\n')) })
				const attachedOutput = yield* Stream.fromQueue(events).pipe(
					Stream.filter((event) => outputText(event).includes('attached')),
					Stream.runHead,
					Effect.map(Option.getOrThrow),
				)
				expect(outputText(attachedOutput)).toContain('attached')

				yield* service.detach({ ptyId })
				yield* Fiber.await(attachedFiber)
				yield* service.write({ ptyId, data: Array.from(new TextEncoder().encode('echo detached\n')) })

				const replay = yield* service.attach({ ptyId }).pipe(
					Stream.filter((event) => event.event === 'output'),
					Stream.filter((event) => outputText(event).includes('detached')),
					Stream.runHead,
				)
				expect(replay._tag).toBe('Some')
				if (Option.isSome(replay)) expect(outputText(replay.value)).toContain('detached')

				yield* service.resize({ ptyId, cols: 120, rows: 40 })
				yield* service.kill({ ptyId })
				expect(yield* service.list).not.toContain(ptyId)
			}),
		).pipe(Effect.provide(PtyTestLive)),
	)
})
