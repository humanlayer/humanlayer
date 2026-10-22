import { EventEmitter } from 'node:events'

import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { DesktopRpc } from '@humanlayer/riptide-electron-rpc'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Predicate from 'effect/Predicate'
import * as Queue from 'effect/Queue'
import * as RpcClient from 'effect/rpc/RpcClient'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { TestClock } from 'effect/testing'
import type { MessagePortMain } from 'electron'

import { DaemonSupervisor } from '../src/daemon/daemon-supervisor.service'
import { ClaudeCodeCli } from '../src/diagnostics/claude-code-cli.service'
import { HumanLayerCli } from '../src/diagnostics/humanlayer-cli.service'
import { DirectoryPicker } from '../src/directory-picker/directory-picker.service'
import { EditorService } from '../src/editor/editor-service'
import { HostIdService } from '../src/host/host-id-service'
import { HostLogService } from '../src/logging/host-log-service'
import { ElectronPlatform, type ElectronWindowHandle } from '../src/platform/electron-platform.service'
import { InheritedEnvironment } from '../src/platform/inherited-environment'
import { DesktopRpcHandlers } from '../src/rpc/desktop-rpc-handlers'
import { MessagePortServer, MessagePortServerLive, messagePortProtocol } from '../src/rpc/message-port-server'
import { ElectronShell } from '../src/shell/electron-shell.service'
import { ElectronUpdaterService } from '../src/updater/electron-updater.service'
import { WindowService } from '../src/window/window-service'
import { deepLinkServiceTestLayer } from './deep-link-service.test-layer'
import { ptyServiceTestLayer } from './pty-service.test-layer'
import { makeDragTestNative } from './window-drag.test-native'
import { workspaceFilesystemServicesTestLayer } from './workspace-filesystem-services.test-layer'

class FakePort extends EventEmitter implements MessagePortMain {
	readonly sent: unknown[] = []
	started = false
	closed = false
	peer: FakePort | undefined
	readonly pending: unknown[] = []

	start() {
		this.started = true
		for (const data of this.pending.splice(0)) this.emit('message', { data })
	}

	postMessage(message: unknown) {
		if (this.closed) return
		this.sent.push(message)
		const peer = this.peer
		if (peer === undefined || peer.closed) return
		if (peer.started) peer.emit('message', { data: message })
		else peer.pending.push(message)
	}

	close() {
		if (this.closed) return
		this.closed = true
		this.emit('close')
		this.peer?.close()
	}
}

describe('message-port RPC server protocol', () => {
	it.effect('routes concurrent valid envelopes and ignores malformed payloads', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const port = new FakePort()
				const protocol = yield* messagePortProtocol(port as unknown as MessagePortMain)
				const received = yield* Queue.unbounded<string | number>()
				const fiber = yield* Effect.forkChild(
					protocol.run((_clientId, request) =>
						Predicate.isTagged(request, 'Request') ? Queue.offer(received, request.id) : Effect.void,
					),
					{ startImmediately: true },
				)

				port.emit('message', { data: { nope: true } })
				port.emit('message', { data: request('1') })
				port.emit('message', { data: request('2') })

				expect(yield* Queue.take(received)).toBe('1')
				expect(yield* Queue.take(received)).toBe('2')
				expect(port.started).toBe(true)
				yield* Fiber.interrupt(fiber)
			}),
		),
	)

	it.effect('routes cancellation, sends responses, and reports disconnect cleanup', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const port = new FakePort()
				const protocol = yield* messagePortProtocol(port as unknown as MessagePortMain)
				const interrupted = yield* Deferred.make<string | number>()
				const fiber = yield* Effect.forkChild(
					protocol.run((_clientId, request) =>
						Predicate.isTagged(request, 'Interrupt')
							? Deferred.succeed(interrupted, request.requestId)
							: Effect.void,
					),
					{ startImmediately: true },
				)

				port.emit('message', { data: { _tag: 'Interrupt', requestId: '7' } })
				expect(yield* Deferred.await(interrupted)).toBe('7')

				yield* protocol.send(1, {
					_tag: 'Exit',
					requestId: '7',
					exit: { _tag: 'Success', value: undefined },
				})
				expect(port.sent).toHaveLength(1)

				port.close()
				expect(yield* Queue.take(protocol.disconnects)).toBe(1)
				yield* Fiber.interrupt(fiber)
			}),
		),
	)

	it.effect('closes replaced ports and isolates cancellable drag handlers across two requester windows', () => {
		const createdPorts: FakePort[] = []
		let rendererReady: (() => void) | undefined
		const windowHandle: ElectronWindowHandle = {
			id: 1,
			dragWindow: Effect.die('dragWindow was not expected'),
			destroy: Effect.void,
			setThemeSource: () => Effect.void,
			setZoomFactor: () => Effect.void,
			stateChanges: Stream.empty,
			showAndFocus: Effect.void,
			createMessageChannel: () => {
				const port1 = new FakePort()
				const port2 = new FakePort()
				createdPorts.push(port1)
				return {
					port1: port1 as unknown as MessagePortMain,
					port2: port2 as unknown as MessagePortMain,
				}
			},
			postMessage: () => undefined,
			onRendererReady: (listener) => {
				rendererReady = listener
				return () => {
					rendererReady = undefined
				}
			},
			onClosed: () => () => undefined,
		}
		const domainServices = Layer.mergeAll(
			Layer.succeed(InheritedEnvironment, { snapshot: Effect.die('Native environment was not expected') }),
			Layer.succeed(DirectoryPicker, DirectoryPicker.of({ pickDirectory: Effect.succeed(null) })),
			deepLinkServiceTestLayer,
			ptyServiceTestLayer,
			workspaceFilesystemServicesTestLayer,
			NodeServices.layer,
			Layer.succeed(
				DaemonSupervisor,
				DaemonSupervisor.of({
					start: () => Effect.die('start daemon was not expected'),
					stop: () => Effect.die('stop daemon was not expected'),
					isRunning: () => Effect.succeed(false),
					setManagementEnabled: () => Effect.die('daemon management was not expected'),
					lifecycleEvents: Stream.empty,
				}),
			),
			Layer.succeed(
				ClaudeCodeCli,
				ClaudeCodeCli.of({
					checkInstallation: Effect.die('checkInstallation was not expected'),
					updateToLatest: Effect.die('updateToLatest was not expected'),
					probeAgent: () => Effect.die('probeAgent was not expected'),
				}),
			),
			Layer.succeed(HumanLayerCli, HumanLayerCli.of({ updateToLatest: Effect.void })),
			Layer.succeed(
				ElectronPlatform,
				ElectronPlatform.of({
					productName: 'HumanLayer-Test Electron',
					version: '1.2.3',
					isPackaged: false,
					resourcesPath: '/resources',
					preloadPath: '/preload.cjs',
					homeDirectory: '/Users/test',
					userDataPath: '/test/profile',
					configureBeforeReady: () => Effect.void,
					whenReady: Effect.void,
					requestSingleInstanceLock: Effect.succeed(true),
					secondInstanceEvents: Stream.empty,
					quit: Effect.void,
					resolveWindowState: ({ persistedState, defaultWidth, defaultHeight }) =>
						Effect.succeed(
							persistedState ?? {
								width: defaultWidth,
								height: defaultHeight,
								x: 0,
								y: 0,
								maximized: false,
							},
						),
					setApplicationIcon: () => Effect.void,
					openWindow: () => Effect.die('openWindow was not expected'),
				}),
			),
			Layer.succeed(EditorService, EditorService.of({ open: () => Effect.void })),
			Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed('test-host-id') })),
			Layer.succeed(
				HostLogService,
				HostLogService.of({
					writeHostLog: () => Effect.void,
					getLogDirectory: Effect.succeed('/test/logs'),
					getCurrentLogFiles: Effect.succeed([]),
				}),
			),
			Layer.succeed(ElectronShell, ElectronShell.of({ openExternal: () => Effect.void })),
			Layer.succeed(
				WindowService,
				WindowService.of({
					openMainWindow: Effect.die('openMainWindow was not expected'),
					openNewWindow: Effect.die('openNewWindow was not expected'),
					openedWindows: Stream.empty,
					setWindowTheme: () => Effect.void,
					setZoom: () => Effect.void,
				}),
			),
			Layer.succeed(
				ElectronUpdaterService,
				ElectronUpdaterService.of({
					checkForAppUpdate: () => Effect.succeed(null),
					downloadAvailableUpdate: () => Effect.void,
					downloadProgress: Stream.empty,
					quitAndInstallUpdate: () => Effect.die('quitAndInstall was not expected'),
				}),
			),
		)
		const handlers = DesktopRpcHandlers.pipe(Layer.provide(domainServices))
		const server = MessagePortServerLive.pipe(Layer.provide(handlers))

		return Effect.gen(function* () {
			const messagePortServer = yield* MessagePortServer
			const attachment = yield* messagePortServer.attach(windowHandle)
			expect(createdPorts).toHaveLength(1)
			expect(createdPorts[0]?.closed).toBe(false)

			rendererReady?.()
			expect(createdPorts).toHaveLength(2)
			expect(createdPorts[0]?.closed).toBe(true)
			expect(createdPorts[1]?.closed).toBe(false)

			yield* attachment.close
			expect(createdPorts[1]?.closed).toBe(true)
			yield* verifyRequesterWindowDrags
		}).pipe(Effect.provide(server))
	})
})

function request(id: string) {
	return { _tag: 'Request' as const, id, tag: 'GetHostId', payload: {}, headers: [] }
}

// Uses the real MessagePortServerLive attachment path, production handler group,
// protocol codecs and RpcClient cancellation -- not RpcTest or direct handlers.
const verifyRequesterWindowDrags = Effect.gen(function* () {
	const server = yield* MessagePortServer
	const makeRequester = Effect.gen(function* () {
		const native = yield* makeDragTestNative()
		const rendererPorts = yield* Queue.unbounded<FakePort>()
		const lifecycle = new EventEmitter()
		const handle: ElectronWindowHandle = {
			id: 42, // Deliberately the same: identity must come from the attachment, not IDs.
			dragWindow: native.dragWindow,
			destroy: Effect.void,
			setThemeSource: () => Effect.die('setThemeSource was not expected'),
			setZoomFactor: () => Effect.die('setZoomFactor was not expected'),
			showAndFocus: Effect.die('showAndFocus was not expected'),
			stateChanges: Stream.empty,
			createMessageChannel: () => {
				const port1 = new FakePort()
				const port2 = new FakePort()
				port1.peer = port2
				port2.peer = port1
				return { port1, port2 }
			},
			postMessage: (_channel, port) => {
				// The channel factory above is the only producer of these test ports.
				if (!(port instanceof FakePort)) throw new Error('Unexpected message port')
				Queue.offerUnsafe(rendererPorts, port)
			},
			onRendererReady: (listener) => {
				lifecycle.on('ready', listener)
				return () => {
					lifecycle.off('ready', listener)
				}
			},
			onClosed: (listener) => {
				lifecycle.on('closed', listener)
				return () => {
					lifecycle.off('closed', listener)
				}
			},
		}
		const attachment = yield* server.attach(handle)
		yield* Effect.addFinalizer(() => attachment.close)
		const port = yield* Queue.take(rendererPorts)
		const client = yield* makePortClient(port)
		return { ...native, port, client, lifecycle, rendererPorts }
	})
	const first = yield* makeRequester
	const second = yield* makeRequester
	first.press()
	first.release()
	expect(yield* Effect.flip(first.client.DragWindow())).toMatchObject({ reason: 'unavailable' })
	yield* Queue.take(first.samples)
	yield* Queue.take(first.finalized)
	first.press()
	const firstDrag = yield* first.client.DragWindow().pipe(Effect.forkChild)
	yield* first.started
	expect(yield* Queue.size(second.samples)).toBe(0)
	second.press()
	const secondDrag = yield* second.client.DragWindow().pipe(Effect.forkChild)
	yield* second.started
	expect(yield* Effect.flip(first.client.DragWindow())).toMatchObject({ reason: 'busy' })
	// The refused request also finalizes, but must not release the active gesture.
	yield* Queue.take(first.finalized)
	expect(first.window.listenerCount('blur')).toBe(1)
	first.screen.cursor.x += 10
	second.screen.cursor.y += 20
	yield* TestClock.adjust('16 millis')
	expect(first.window.moves).toEqual([{ x: -790, y: 120, animate: false }])
	expect(second.window.moves).toEqual([{ x: -800, y: 140, animate: false }])

	// Unary client fiber interruption must reach the native gesture finalizer.
	yield* Fiber.interrupt(firstDrag)
	yield* Queue.take(first.finalized)
	expect(first.listenerCounts()).toEqual(first.trackingListeners)
	expect(second.window.listenerCount('blur')).toBe(1)

	// A renderer-port disconnect cancels its server request, even without UI cleanup.
	second.port.close()
	yield* Queue.take(second.finalized)
	expect(second.listenerCounts()).toEqual(second.trackingListeners)
	yield* Fiber.interrupt(secondDrag)

	// Reconnect/reload reuses the same native bound effect, not another window's.
	first.release()
	first.press()
	const beforeReload = yield* first.client.DragWindow().pipe(Effect.forkChild)
	// Drain the earlier movement sample before awaiting the new anchor and sample.
	yield* Queue.take(first.samples)
	yield* first.started
	first.lifecycle.emit('ready')
	yield* Queue.take(first.finalized)
	expect(first.listenerCounts()).toEqual(first.trackingListeners)
	yield* Fiber.interrupt(beforeReload)
	const newClient = yield* makePortClient(yield* Queue.take(first.rendererPorts))
	first.release()
	first.press()
	const afterReload = yield* newClient.DragWindow().pipe(Effect.forkChild)
	yield* first.started
	first.lifecycle.emit('closed')
	first.destroy()
	yield* Queue.take(first.finalized)
	expect(first.window.eventNames()).toEqual([])
	expect(first.window.renderer.eventNames()).toEqual([])
	yield* Fiber.interrupt(afterReload)
	first.screen.cursor.x += 100
	second.screen.cursor.y += 100
	yield* TestClock.adjust('1 second')
	expect(first.window.moves).toHaveLength(1)
	expect(second.window.moves).toHaveLength(1)
})

function makePortClient(port: FakePort) {
	return Effect.gen(function* () {
		const protocol = yield* RpcClient.Protocol.make((writeResponse) =>
			Effect.gen(function* () {
				const context = yield* Effect.context<never>()
				let activeClientId = 0
				const onMessage = (event: Electron.MessageEvent) => {
					Effect.runForkWith(context)(writeResponse(activeClientId, event.data))
				}
				yield* Effect.acquireRelease(
					Effect.sync(() => {
						port.on('message', onMessage)
						port.start()
					}),
					() =>
						Effect.sync(() => {
							port.off('message', onMessage)
							port.close()
						}),
				)
				return {
					send: (clientId, request) =>
						Effect.sync(() => {
							activeClientId = clientId
							port.postMessage(request)
						}),
					supportsAck: false,
					supportsTransferables: false,
					codecFor: Schema.toCodecJson,
				}
			}),
		)
		return yield* RpcClient.make(DesktopRpc).pipe(Effect.provideService(RpcClient.Protocol, protocol))
	})
}
