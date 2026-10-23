import { EventEmitter } from 'node:events'

import { Effect, Queue } from 'effect'

import { makeWindowDrag } from '../src/platform/window-drag'

class TestWebContents extends EventEmitter {
	destroyed = false
	isDestroyed() {
		return this.destroyed
	}
}

class TestWindow extends EventEmitter {
	readonly renderer = new TestWebContents()
	get webContents() {
		if (this.destroyed) throw new TypeError('Object has been destroyed')
		return this.renderer
	}
	destroyed = false
	focused = true
	maximized = false
	fullScreen = false
	bounds = { x: -800, y: 120, width: 1000, height: 700 }
	readonly moves: Array<{ x: number; y: number; animate: boolean | undefined }> = []
	moveFailure: Error | undefined

	isDestroyed() {
		return this.destroyed
	}
	isFocused() {
		return this.focused
	}
	isMaximized() {
		return this.maximized
	}
	isFullScreen() {
		return this.fullScreen
	}
	getBounds() {
		return { ...this.bounds }
	}
	setPosition(x: number, y: number, animate?: boolean) {
		if (this.moveFailure !== undefined) throw this.moveFailure
		this.moves.push({ x, y, animate })
		this.bounds = { ...this.bounds, x, y }
	}
}

export const makeDragTestNative = (
	input: {
		readonly supported?: boolean
		readonly state?: 'destroyed' | 'maximized' | 'fullScreen' | 'unfocused' | 'rendererDestroyed'
	} = {},
) =>
	Effect.gen(function* () {
		const window = new TestWindow()
		window.destroyed = input.state === 'destroyed'
		window.maximized = input.state === 'maximized'
		window.fullScreen = input.state === 'fullScreen'
		window.focused = input.state !== 'unfocused'
		window.renderer.destroyed = input.state === 'rendererDestroyed'
		const samples = yield* Queue.unbounded<void>()
		const finalized = yield* Queue.unbounded<void>()
		const screen = {
			cursor: { x: -600, y: 140 },
			getCursorScreenPoint() {
				Queue.offerUnsafe(samples, undefined)
				return { ...this.cursor }
			},
		}
		const dragWindow = makeWindowDrag({ window, screen, supported: input.supported ?? true }).pipe(
			Effect.ensuring(Queue.offer(finalized, undefined)),
		)
		const destroy = () => {
			window.destroyed = true
			window.emit('closed')
			window.renderer.destroyed = true
			window.renderer.emit('destroyed')
		}
		yield* Effect.addFinalizer(() => Effect.sync(destroy))
		const listenerCounts = () => ({
			window: window.eventNames().map((event) => [event, window.listenerCount(event)]),
			renderer: window.renderer.eventNames().map((event) => [event, window.renderer.listenerCount(event)]),
		})
		return {
			window,
			screen,
			samples,
			finalized,
			dragWindow,
			press: () => window.renderer.emit('before-mouse-event', {}, { type: 'mouseDown', button: 'left' }),
			release: () => window.renderer.emit('before-mouse-event', {}, { type: 'mouseUp', button: 'left' }),
			destroy,
			listenerCounts,
			trackingListeners: listenerCounts(),
			// Native mouseDown captures the anchor; the RPC samples before its first sleep.
			started: Queue.take(samples).pipe(Effect.andThen(Queue.take(samples))),
		}
	})
