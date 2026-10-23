import * as NodeServices from '@effect/platform-node/NodeServices'
import { SentryEffectMetricsLayer, SentryEffectTracer } from '@sentry/effect/server'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import * as Stream from 'effect/Stream'
import * as Tracer from 'effect/Tracer'

import { loadElectronConfig } from '../config/electron-config'
import { makeDaemonSupervisorLive } from '../daemon/daemon-supervisor.layer'
import type { DaemonSupervisor } from '../daemon/daemon-supervisor.service'
import { DeepLinkPlatformLive } from '../deep-links/deep-link-platform.layer'
import { DeepLinkService } from '../deep-links/deep-link-service'
import { makeDeepLinkServiceLive } from '../deep-links/deep-link-service.layer'
import { ClaudeCodeCliLive } from '../diagnostics/claude-code-cli.layer'
import type { ClaudeCodeCli } from '../diagnostics/claude-code-cli.service'
import { makeHumanLayerCliLive } from '../diagnostics/humanlayer-cli.layer'
import type { HumanLayerCli } from '../diagnostics/humanlayer-cli.service'
import { DirectoryPickerLive } from '../directory-picker/directory-picker.layer'
import type { DirectoryPicker } from '../directory-picker/directory-picker.service'
import { ApplicationLauncherLive } from '../editor/application-launcher.layer'
import { EditorEnvironmentService, EditorEnvironmentServiceLive } from '../editor/editor-environment-service'
import type { EditorService } from '../editor/editor-service'
import { EditorServiceLive } from '../editor/editor-service.layer'
import type { FilesystemService } from '../filesystem/filesystem-service'
import { FilesystemServiceLive } from '../filesystem/filesystem-service.layer'
import type { HostIdService } from '../host/host-id-service'
import { makeHostIdServiceLive } from '../host/host-id-service.layer'
import { Sentry } from '../instrument'
import { makeEffectLoggerLive } from '../logging/effect-logger'
import { HostLogService } from '../logging/host-log-service'
import { makeHostLogServiceLive } from '../logging/host-log-service.layer'
import { ElectronPlatformLive } from '../platform/electron-platform.layer'
import { ElectronPlatform } from '../platform/electron-platform.service'
import type { InheritedEnvironment } from '../platform/inherited-environment'
import { NativeEnvironmentLive, NativeScalarConfigLive } from '../platform/native-environment.layer'
import type { PtyService } from '../pty/pty-service'
import { PtyServiceLive } from '../pty/pty-service.layer'
import { RepositoryDiscoveryServiceLive } from '../repository-discovery/repository-discovery.layer'
import type { RepositoryDiscoveryService } from '../repository-discovery/repository-discovery.service'
import { DesktopRpcHandlers } from '../rpc/desktop-rpc-handlers'
import { MessagePortServer, MessagePortServerLive } from '../rpc/message-port-server'
import { RpcWindowAttachmentLive } from '../rpc/window-attachment.layer'
import { ElectronShellLive } from '../shell/electron-shell.layer'
import type { ElectronShell } from '../shell/electron-shell.service'
import { ElectronUpdaterServiceLive } from '../updater/electron-updater.layer'
import type { ElectronUpdaterService } from '../updater/electron-updater.service'
import { WindowService } from '../window/window-service'
import { makeWindowServiceLive } from '../window/window-service.layer'
import type { WorkspaceConfigService } from '../workspace/workspace-config-service'
import { WorkspaceConfigServiceLive } from '../workspace/workspace-config-service.layer'

export type AppRuntimeServices =
	| InheritedEnvironment
	| ElectronPlatform
	| DaemonSupervisor
	| ClaudeCodeCli
	| HumanLayerCli
	| HostIdService
	| EditorService
	| ElectronShell
	| HostLogService
	| MessagePortServer
	| WindowService
	| PtyService
	| FilesystemService
	| WorkspaceConfigService
	| EditorEnvironmentService
	| DeepLinkService
	| ElectronUpdaterService
	| RepositoryDiscoveryService
	| DirectoryPicker
export type AppRuntime = ManagedRuntime.ManagedRuntime<AppRuntimeServices, never>

// Raw-env semantics belong to these two adapters only. All other Config consumers
// retain Effect's default fromEnv snapshot, import.meta.env precedence, and empty-as-missing behavior.
const NativeElectronPlatformLive = ElectronPlatformLive.pipe(Layer.provide(NativeScalarConfigLive))
const NativeEditorEnvironmentLive = EditorEnvironmentServiceLive.pipe(Layer.provide(NativeScalarConfigLive))
const PlatformLive = Layer.mergeAll(NativeElectronPlatformLive, NodeServices.layer)
const SentryObservabilityLive = Layer.mergeAll(
	Layer.succeed(Tracer.Tracer, SentryEffectTracer),
	SentryEffectMetricsLayer,
	Layer.effectDiscard(Effect.addFinalizer(() => Effect.promise(() => Sentry.close(2_000)).pipe(Effect.asVoid))),
)

const ConfiguredRuntimeLive = Layer.unwrap(
	loadElectronConfig.pipe(
		Effect.map((config) => {
			const ObservabilityLive = Layer.mergeAll(SentryObservabilityLive, makeEffectLoggerLive(config)).pipe(
				Layer.provide(NodeServices.layer),
			)
			const InfrastructureLive = Layer.mergeAll(
				NativeElectronPlatformLive,
				DeepLinkPlatformLive,
				NodeServices.layer,
				NativeEnvironmentLive,
				ObservabilityLive,
			)
			const ApplicationSetupLive = Layer.effectDiscard(
				Effect.gen(function* () {
					const platform = yield* ElectronPlatform
					yield* platform.configureBeforeReady({
						remoteDebuggingPort: config.cdpEnabled ? config.remoteDebuggingPort : undefined,
					})
					yield* Effect.logInfo('Electron application configured').pipe(
						Effect.annotateLogs({ channel: config.channel, cdp_enabled: config.cdpEnabled }),
					)
				}),
			).pipe(Layer.provide(InfrastructureLive))
			const HostIdLive = makeHostIdServiceLive(config).pipe(Layer.provide(InfrastructureLive))
			const DeepLinksLive = makeDeepLinkServiceLive(config).pipe(Layer.provide(InfrastructureLive))
			const ClaudeCodeCliApplicationLive = ClaudeCodeCliLive.pipe(Layer.provide(InfrastructureLive))
			const HumanLayerCliApplicationLive = makeHumanLayerCliLive({ updateEnabled: config.isPackaged }).pipe(
				Layer.provide(InfrastructureLive),
			)
			const HostLogLive = makeHostLogServiceLive(config).pipe(Layer.provide(InfrastructureLive))
			const ApplicationLauncherApplicationLive = ApplicationLauncherLive.pipe(Layer.provide(InfrastructureLive))
			const EditorLive = EditorServiceLive.pipe(
				Layer.provide(Layer.mergeAll(ApplicationLauncherApplicationLive, InfrastructureLive)),
			)
			const WindowLive = makeWindowServiceLive(config).pipe(Layer.provide(InfrastructureLive))
			const DaemonLive = makeDaemonSupervisorLive(config).pipe(
				Layer.provide(Layer.mergeAll(InfrastructureLive, HostIdLive)),
			)
			const UpdaterLive = ElectronUpdaterServiceLive.pipe(Layer.provide(InfrastructureLive))
			const PtyLive = PtyServiceLive.pipe(Layer.provide(InfrastructureLive))
			const FilesystemLive = FilesystemServiceLive.pipe(Layer.provide(InfrastructureLive))
			const RepositoryDiscoveryLive = RepositoryDiscoveryServiceLive
			const WorkspaceConfigLive = WorkspaceConfigServiceLive.pipe(
				Layer.provide(Layer.mergeAll(InfrastructureLive, EditorLive, RepositoryDiscoveryLive)),
			)
			const DirectoryPickerApplicationLive = DirectoryPickerLive
			const RpcHandlersLive = DesktopRpcHandlers.pipe(
				Layer.provide(
					Layer.mergeAll(
						InfrastructureLive,
						ClaudeCodeCliApplicationLive,
						HumanLayerCliApplicationLive,
						HostIdLive,
						HostLogLive,
						EditorLive,
						ElectronShellLive,
						WindowLive,
						DaemonLive,
						PtyLive,
						FilesystemLive,
						WorkspaceConfigLive,
						NativeEditorEnvironmentLive,
						DeepLinksLive,
						UpdaterLive,
						RepositoryDiscoveryLive,
						DirectoryPickerApplicationLive,
					),
				),
			)
			const RpcServerLive = MessagePortServerLive.pipe(Layer.provide(RpcHandlersLive))
			const WindowAttachmentLive = RpcWindowAttachmentLive.pipe(
				Layer.provide(Layer.mergeAll(WindowLive, RpcServerLive)),
			)
			const DeepLinkWindowActivationLive = Layer.effectDiscard(
				Effect.gen(function* () {
					const deepLinks = yield* DeepLinkService
					const windowService = yield* WindowService
					yield* deepLinks.windowActivationRequests.pipe(
						Stream.runForEach(() => windowService.openMainWindow),
						Effect.forkScoped,
					)
				}),
			).pipe(Layer.provide(Layer.mergeAll(DeepLinksLive, WindowLive)))

			return Layer.mergeAll(
				ObservabilityLive,
				NativeElectronPlatformLive,
				ClaudeCodeCliApplicationLive,
				HumanLayerCliApplicationLive,
				HostIdLive,
				HostLogLive,
				EditorLive,
				ElectronShellLive,
				RpcServerLive,
				WindowLive,
				DaemonLive,
				PtyLive,
				FilesystemLive,
				WorkspaceConfigLive,
				NativeEditorEnvironmentLive,
				DeepLinksLive,
				WindowAttachmentLive,
				DeepLinkWindowActivationLive,
				ApplicationSetupLive,
				UpdaterLive,
				RepositoryDiscoveryLive,
				DirectoryPickerApplicationLive,
			)
		}),
	),
).pipe(Layer.provideMerge(Layer.mergeAll(PlatformLive, NativeEnvironmentLive)), Layer.orDie)

export const AppRuntimeLive = ConfiguredRuntimeLive
export const appRuntime: AppRuntime = ManagedRuntime.make(AppRuntimeLive)
