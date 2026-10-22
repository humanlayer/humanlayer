import { EventEmitter } from 'node:events'

import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { DesktopRpc, type DesktopDeepLink } from '@humanlayer/riptide-electron-rpc'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as RpcClient from 'effect/rpc/RpcClient'
import type { FromServerEncoded } from 'effect/rpc/RpcMessage'
import * as RpcServer from 'effect/rpc/RpcServer'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import type { MessagePortMain } from 'electron'

import { DaemonSupervisor } from '../src/daemon/daemon-supervisor.service'
import { DeepLinkService } from '../src/deep-links/deep-link-service'
import { ClaudeCodeCli } from '../src/diagnostics/claude-code-cli.service'
import { HumanLayerCli } from '../src/diagnostics/humanlayer-cli.service'
import { DirectoryPicker } from '../src/directory-picker/directory-picker.service'
import { EditorService } from '../src/editor/editor-service'
import { HostIdService } from '../src/host/host-id-service'
import { HostLogService } from '../src/logging/host-log-service'
import { ElectronPlatform } from '../src/platform/electron-platform.service'
import { InheritedEnvironment } from '../src/platform/inherited-environment'
import { DesktopRpcHandlers } from '../src/rpc/desktop-rpc-handlers'
import { messagePortProtocol } from '../src/rpc/message-port-server'
import { ElectronShell } from '../src/shell/electron-shell.service'
import { ElectronUpdaterService } from '../src/updater/electron-updater.service'
import { WindowService } from '../src/window/window-service'
import { ptyServiceTestLayer } from './pty-service.test-layer'
import { workspaceFilesystemServicesTestLayer } from './workspace-filesystem-services.test-layer'

class LinkedPort extends EventEmitter {
	peer: LinkedPort | undefined

	start() {}

	postMessage(message: unknown) {
		queueMicrotask(() => this.peer?.emit('message', { data: message }))
	}

	close() {
		this.emit('close')
	}
}

function linkedPortPair(): { serverPort: LinkedPort; clientPort: LinkedPort } {
	const serverPort = new LinkedPort()
	const clientPort = new LinkedPort()
	serverPort.peer = clientPort
	clientPort.peer = serverPort
	return { serverPort, clientPort }
}

// Mirrors the renderer protocol in apps/riptide-ui electron-rpc-client.layer.ts,
// bound directly to a port instead of the window handshake.
function testClientProtocol(port: LinkedPort) {
	return RpcClient.Protocol.make((writeResponse) =>
		Effect.gen(function* () {
			const context = yield* Effect.context<never>()
			let activeClientId: number | undefined
			port.on('message', (event: { data: FromServerEncoded }) => {
				if (activeClientId !== undefined) {
					Effect.runForkWith(context)(writeResponse(activeClientId, event.data))
				}
			})
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
}

function deepLinkLayerFromQueue(acceptedLinks: Queue.Queue<DesktopDeepLink>) {
	return Layer.succeed(
		DeepLinkService,
		DeepLinkService.of({
			initializePackagedProtocolClients: Effect.void,
			enableWindowActivation: Effect.void,
			takePending: Queue.poll(acceptedLinks).pipe(Effect.map(Option.getOrNull)),
			events: Stream.fromEffectRepeat(Queue.take(acceptedLinks)),
			windowActivationRequests: Stream.empty,
		}),
	)
}

const stubServices = Layer.mergeAll(
	Layer.succeed(InheritedEnvironment, { snapshot: Effect.die('Native environment was not expected') }),
	Layer.succeed(DirectoryPicker, DirectoryPicker.of({ pickDirectory: Effect.succeed(null) })),
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
					persistedState ?? { width: defaultWidth, height: defaultHeight, x: 0, y: 0, maximized: false },
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

describe('desktop RPC stream delivery', () => {
	it.effect(
		'delivers deep links over the streaming RPC end to end',
		() =>
			Effect.gen(function* () {
				const { serverPort, clientPort } = linkedPortPair()
				const acceptedLinks = yield* Queue.unbounded<DesktopDeepLink>()

				const handlerContext = yield* Layer.build(
					DesktopRpcHandlers.pipe(
						Layer.provide(Layer.mergeAll(deepLinkLayerFromQueue(acceptedLinks), stubServices)),
					),
				)
				const serverProtocol = yield* messagePortProtocol(serverPort as unknown as MessagePortMain)
				yield* Effect.forkChild(
					RpcServer.make(DesktopRpc.omit('DragWindow')).pipe(
						Effect.provide(Context.add(handlerContext, RpcServer.Protocol, serverProtocol)),
					),
					{ startImmediately: true },
				)

				const clientProtocol = yield* testClientProtocol(clientPort)
				const client = yield* RpcClient.make(DesktopRpc.omit('DragWindow')).pipe(
					Effect.provideService(RpcClient.Protocol, clientProtocol),
				)

				// Baseline: plain request/response works over the linked ports.
				expect(yield* client.TakePendingDeepLink()).toBe(null)

				// Streamed delivery: subscribe first, then a link arrives.
				const firstLink = yield* Effect.forkChild(Stream.runHead(client.DeepLinkEvents()), {
					startImmediately: true,
				})
				yield* Effect.yieldNow
				yield* Queue.offer(acceptedLinks, { url: 'humanlayer-electron-dev://oauth/callback?code=stream-1' })

				const received = yield* Fiber.join(firstLink)
				expect(received).toEqual(Option.some({ url: 'humanlayer-electron-dev://oauth/callback?code=stream-1' }))
			}).pipe(Effect.scoped),
		10_000,
	)
})
