import { describe, expect, it } from '@effect/vitest'
import { WindowDragError } from '@humanlayer/riptide-electron-rpc'
import { Effect, Fiber, Logger, Queue } from 'effect'
import { TestClock } from 'effect/testing'

import { supportsWindowDrag } from '../src/platform/window-drag'
import { makeDragTestNative } from './window-drag.test-native'

describe('native window drag adapter', () => {
	it.effect('samples promptly, applies a 4 DIP threshold and deduplicates 16ms moves', () =>
		Effect.gen(function* () {
			const native = yield* makeDragTestNative()
			native.press()
			const fiber = yield* native.dragWindow.pipe(Effect.forkChild)
			yield* native.started
			expect(native.window.moves).toEqual([])

			native.screen.cursor = { x: -597, y: 140 }
			yield* TestClock.adjust('16 millis')
			yield* Queue.take(native.samples)
			expect(native.window.moves).toEqual([])

			native.screen.cursor = { x: -596, y: 140 }
			yield* TestClock.adjust('15 millis')
			expect(native.window.moves).toEqual([])
			yield* TestClock.adjust('1 millis')
			yield* Queue.take(native.samples)
			expect(native.window.moves).toEqual([{ x: -796, y: 120, animate: false }])

			yield* TestClock.adjust('32 millis')
			expect(native.window.moves).toHaveLength(1)
			// Negative multi-monitor DIP coordinates; no renderer zoom conversion.
			native.screen.cursor = { x: -620, y: -20 }
			yield* TestClock.adjust('16 millis')
			expect(native.window.moves.at(-1)).toEqual({ x: -820, y: -40, animate: false })
			// Once dragging, returning inside the threshold still follows the cursor.
			native.screen.cursor = { x: -599, y: 140 }
			yield* TestClock.adjust('16 millis')
			expect(native.window.moves.at(-1)).toEqual({ x: -799, y: 120, animate: false })

			yield* Fiber.interrupt(fiber)
			expect(native.listenerCounts()).toEqual(native.trackingListeners)
			const moves = native.window.moves.length
			native.screen.cursor = { x: 999, y: 999 }
			yield* TestClock.adjust('1 second')
			expect(native.window.moves).toHaveLength(moves)
		}),
	)

	it.effect('rejects a delayed renderer start after native mouseUp, then accepts a fresh press', () =>
		Effect.gen(function* () {
			const native = yield* makeDragTestNative()
			expect(yield* Effect.flip(native.dragWindow)).toMatchObject({ reason: 'unavailable' })
			native.press()
			native.screen.cursor.x += 100
			native.release()
			// Reproduction: renderer processes pointerdown only after the native release.
			expect(yield* Effect.flip(native.dragWindow)).toMatchObject({ reason: 'unavailable' })
			yield* Queue.take(native.samples) // Only the native-down anchor was captured.
			native.screen.cursor.x += 100
			yield* TestClock.adjust('1 second')
			expect(yield* Queue.size(native.samples)).toBe(0)
			expect(native.window.moves).toEqual([])
			native.press()
			const fiber = yield* native.dragWindow.pipe(Effect.forkChild)
			yield* native.started
			native.release()
			yield* Fiber.join(fiber)
			expect(native.window.moves).toEqual([])
		}),
	)

	it.effect('uses the native mouseDown anchor when renderer pointerdown is delayed', () =>
		Effect.gen(function* () {
			const native = yield* makeDragTestNative()
			native.press()
			native.screen.cursor.x += 100
			const fiber = yield* native.dragWindow.pipe(Effect.forkChild)
			yield* native.started
			expect(native.window.moves).toEqual([{ x: -700, y: 120, animate: false }])
			native.release()
			yield* Fiber.join(fiber)
			expect(native.window.moves).toHaveLength(1)
		}),
	)

	it.effect('does not let non-primary presses authorize a window drag', () =>
		Effect.gen(function* () {
			const native = yield* makeDragTestNative()
			for (const button of ['middle', 'right'] as const) {
				native.window.webContents.emit('before-mouse-event', {}, { type: 'mouseDown', button })
				expect(yield* Effect.flip(native.dragWindow)).toMatchObject({ reason: 'unavailable' })
			}
			expect(yield* Queue.size(native.samples)).toBe(0)
			expect(native.window.moves).toEqual([])
		}),
	)

	for (const event of ['blur', 'did-start-navigation', 'render-process-gone'] as const) {
		it.effect(`invalidates an unclaimed native press on ${event}`, () =>
			Effect.gen(function* () {
				const native = yield* makeDragTestNative()
				native.press()
				yield* Queue.take(native.samples)
				if (event === 'blur') native.window.emit(event)
				else native.window.webContents.emit(event, { isMainFrame: true, isSameDocument: false })
				native.screen.cursor.x += 100
				expect(yield* Effect.flip(native.dragWindow)).toMatchObject({ reason: 'unavailable' })
				expect(yield* Queue.size(native.samples)).toBe(0)
				expect(native.window.moves).toEqual([])
			}),
		)
	}

	it.effect('applies the final native mouseUp position for movement entirely between timer ticks', () =>
		Effect.gen(function* () {
			const native = yield* makeDragTestNative()
			native.press()
			const fiber = yield* native.dragWindow.pipe(Effect.forkChild)
			yield* native.started
			native.screen.cursor.x += 100
			// No clock advance: no 16ms sample has seen this movement.
			native.release()
			expect(native.window.moves).toEqual([{ x: -700, y: 120, animate: false }])
			// Cursor changes before the RPC continuation runs must not change the result.
			native.screen.cursor.x += 200
			yield* Fiber.join(fiber)
			yield* TestClock.adjust('1 second')
			native.release() // Duplicate release is harmless.
			expect(native.window.moves).toEqual([{ x: -700, y: 120, animate: false }])
			expect(native.listenerCounts()).toEqual(native.trackingListeners)
		}),
	)

	it.effect('keeps sub-threshold native releases as clicks', () =>
		Effect.gen(function* () {
			const native = yield* makeDragTestNative()
			native.press()
			const fiber = yield* native.dragWindow.pipe(Effect.forkChild)
			yield* native.started
			native.screen.cursor.x += 3
			native.release()
			yield* Fiber.join(fiber)
			expect(native.window.moves).toEqual([])
		}),
	)

	it.effect('does not apply a final sample on cancellation or a later native release', () =>
		Effect.gen(function* () {
			const native = yield* makeDragTestNative()
			native.press()
			const fiber = yield* native.dragWindow.pipe(Effect.forkChild)
			yield* native.started
			native.screen.cursor.x += 100
			yield* Fiber.interrupt(fiber)
			native.release()
			yield* TestClock.adjust('1 second')
			expect(native.window.moves).toEqual([])
			expect(yield* Queue.size(native.samples)).toBe(0)
			expect(native.listenerCounts()).toEqual(native.trackingListeners)
		}),
	)

	for (const target of ['window', 'renderer'] as const) {
		it.effect(`removes idle native tracking listeners on ${target} destruction`, () =>
			Effect.gen(function* () {
				const native = yield* makeDragTestNative()
				expect(native.window.webContents.listenerCount('before-mouse-event')).toBe(1)
				native.press()
				yield* Queue.take(native.samples)
				if (target === 'window') native.destroy()
				else {
					native.window.webContents.destroyed = true
					native.window.webContents.emit('destroyed')
				}
				expect(native.listenerCounts()).toEqual({ window: [], renderer: [] })
				native.press()
				expect(yield* Effect.flip(native.dragWindow)).toMatchObject({ reason: 'unavailable' })
				expect(yield* Queue.size(native.samples)).toBe(0)
				native.destroy() // Other destruction notification / duplicate cleanup.
				expect(native.listenerCounts()).toEqual({ window: [], renderer: [] })
			}),
		)
	}

	for (const event of ['blur', 'closed', 'maximize', 'enter-full-screen'] as const) {
		it.effect(`ends without a final movement on window ${event}`, () =>
			Effect.gen(function* () {
				const native = yield* makeDragTestNative()
				native.press()
				const fiber = yield* native.dragWindow.pipe(Effect.forkChild)
				yield* native.started
				native.screen.cursor.x += 100
				if (event === 'closed') native.destroy()
				else native.window.emit(event)
				yield* Fiber.join(fiber)
				native.release()
				expect(native.listenerCounts()).toEqual(
					event === 'closed' ? { window: [], renderer: [] } : native.trackingListeners,
				)
				yield* TestClock.adjust('1 second')
				expect(native.window.moves).toEqual([])
			}),
		)
	}

	for (const event of ['did-start-navigation', 'render-process-gone', 'destroyed'] as const) {
		it.effect(`ends without a final movement on renderer ${event}`, () =>
			Effect.gen(function* () {
				const native = yield* makeDragTestNative()
				native.press()
				const fiber = yield* native.dragWindow.pipe(Effect.forkChild)
				yield* native.started
				native.screen.cursor.x += 100
				native.window.webContents.emit(
					event,
					{ isMainFrame: true, isSameDocument: false },
					{ type: 'mouseUp', button: 'left' },
				)
				yield* Fiber.join(fiber)
				native.release()
				expect(native.listenerCounts()).toEqual(
					event === 'destroyed' ? { window: [], renderer: [] } : native.trackingListeners,
				)
				yield* TestClock.adjust('1 second')
				expect(native.window.moves).toEqual([])
			}),
		)
	}

	it.effect('ignores unrelated mouse releases and subframe / same-document navigation', () =>
		Effect.gen(function* () {
			const native = yield* makeDragTestNative()
			native.press()
			const fiber = yield* native.dragWindow.pipe(Effect.forkChild)
			yield* native.started
			native.window.webContents.emit('before-mouse-event', {}, { type: 'mouseUp', button: 'right' })
			native.window.webContents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
			native.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
			native.screen.cursor.x += 10
			yield* TestClock.adjust('16 millis')
			expect(native.window.moves).toHaveLength(1)
			yield* Fiber.interrupt(fiber)
		}),
	)

	it.effect('refuses concurrent gestures without queuing and allows a new gesture after cancellation', () =>
		Effect.gen(function* () {
			const native = yield* makeDragTestNative()
			native.press()
			const first = yield* native.dragWindow.pipe(Effect.forkChild)
			yield* native.started
			expect(yield* Effect.flip(native.dragWindow)).toMatchObject({ reason: 'busy' })
			expect(native.window.listenerCount('blur')).toBe(1)
			yield* Fiber.interrupt(first)
			expect(yield* Effect.flip(native.dragWindow)).toMatchObject({ reason: 'unavailable' })
			native.release()
			native.press()
			const second = yield* native.dragWindow.pipe(Effect.forkChild)
			yield* native.started
			expect(native.window.listenerCount('blur')).toBe(1)
			yield* Fiber.interrupt(second)
			expect(native.listenerCounts()).toEqual(native.trackingListeners)
		}),
	)

	for (const state of [
		'destroyed',
		'maximized',
		'fullScreen',
		'unfocused',
		'rendererDestroyed',
		'unsupported',
	] as const) {
		it.effect(`refuses ${state} windows without sampling or starting a gesture`, () =>
			Effect.gen(function* () {
				const native = yield* makeDragTestNative(state === 'unsupported' ? { supported: false } : { state })
				native.press()
				expect(yield* Effect.flip(native.dragWindow)).toMatchObject({ reason: 'unavailable' })
				expect(yield* Queue.size(native.samples)).toBe(0)
				expect(native.listenerCounts()).toEqual(native.trackingListeners)
				expect(native.window.moves).toEqual([])
			}),
		)
	}

	for (const completion of ['timer', 'release'] as const) {
		it.effect(`captures native ${completion} sample failures, narrows them and releases the gesture`, () =>
			Effect.gen(function* () {
				const native = yield* makeDragTestNative()
				native.press()
				const logs: unknown[] = []
				const fiber = yield* native.dragWindow.pipe(
					Effect.provide(Logger.layer([Logger.make(({ message }) => logs.push(message))])),
					Effect.forkChild,
				)
				yield* native.started
				native.window.moveFailure = new Error('native move failed')
				native.screen.cursor.x += 10
				if (completion === 'timer') yield* TestClock.adjust('16 millis')
				else native.release()
				expect(yield* Effect.flip(Fiber.join(fiber))).toEqual(
					new WindowDragError({ reason: 'failed', message: 'Failed to drag window' }),
				)
				expect(logs).toEqual([
					['Electron window drag failed', expect.objectContaining({ cause: native.window.moveFailure })],
				])
				expect(native.listenerCounts()).toEqual(native.trackingListeners)
				native.window.moveFailure = undefined
				native.release()
				native.press()
				const retry = yield* native.dragWindow.pipe(Effect.forkChild)
				// Drain the failure tick, then await the next anchor/sample.
				yield* Queue.take(native.samples)
				yield* native.started
				yield* Fiber.interrupt(retry)
			}),
		)
	}

	it('fails closed on native Wayland while allowing explicit X11 / XWayland', () => {
		const input = { platform: 'linux', ozonePlatform: '', sessionType: undefined, waylandDisplay: undefined }
		expect(supportsWindowDrag(input)).toBe(true)
		expect(supportsWindowDrag({ ...input, ozonePlatform: 'wayland' })).toBe(false)
		expect(supportsWindowDrag({ ...input, sessionType: 'wayland' })).toBe(false)
		expect(supportsWindowDrag({ ...input, waylandDisplay: 'wayland-0' })).toBe(false)
		expect(supportsWindowDrag({ ...input, ozonePlatform: 'auto', sessionType: 'wayland' })).toBe(false)
		expect(supportsWindowDrag({ ...input, ozonePlatform: 'x11', waylandDisplay: 'wayland-0' })).toBe(true)
		expect(supportsWindowDrag({ ...input, platform: 'darwin', sessionType: 'wayland' })).toBe(true)
	})
})
