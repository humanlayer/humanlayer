import type { DaemonStage } from '@humanlayer/schemas/effect/daemon/stage'
import * as Clock from 'effect/Clock'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'

import { ElectronPlatform } from '../platform/electron-platform.service'
import { protocolSchemesByChannel, resolveChannel } from './electron-channel'
import updaterConfigByChannelJson from './updater-channels.json'

export { channelFromProductName } from './electron-channel'

export interface UpdaterConfig {
	readonly productName: string
	readonly url: string
	readonly updaterCacheDirName: string
}

export const updaterConfigByChannel: Record<DaemonStage, UpdaterConfig> = updaterConfigByChannelJson

export interface ElectronConfig {
	readonly channel: DaemonStage
	readonly isPackaged: boolean
	readonly userDataPath: string
	/** The user's home directory. Used to locate the shared riptide host_id file. */
	readonly homeDirectory: string
	/** The active devstack id (DEVSTACK_ID), when running against a devstack. */
	readonly devstackId: string | undefined
	readonly rendererUrl: URL
	readonly applicationIconPath: string | undefined
	readonly remoteDebuggingPort: number
	readonly cdpEnabled: boolean
	readonly openDevTools: boolean
	readonly logPath: string
	readonly daemonMode: 'external' | 'staged' | 'packaged'
	readonly stagedDaemonPath?: string | undefined
	readonly protocolSchemes: ReadonlyArray<string>
}

function logTimestamp(epochMillis: number): string {
	return new Date(epochMillis).toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

export const loadElectronConfig = Effect.gen(function* () {
	const pathService = yield* Path.Path
	const platform = yield* ElectronPlatform
	const environmentChannel = yield* Config.String('ELECTRON_CHANNEL').pipe(Config.option)
	const channel = resolveChannel({
		isPackaged: platform.isPackaged,
		productName: platform.productName,
		environmentChannel: Option.getOrUndefined(environmentChannel),
	})
	// configure-user-data.ts binds the profile path before Chromium starts; read
	// it back from the platform instead of deriving it a second time.
	const userDataPath = platform.userDataPath
	const rendererPath = yield* Config.String('RIPTIDE_ELECTRON_RENDERER_PATH').pipe(Config.option)
	const defaultRendererUrl = yield* Option.match(rendererPath, {
		onNone: () => Effect.succeed(new URL('http://localhost:3000')),
		onSome: (path) => pathService.toFileUrl(pathService.resolve(path)),
	})
	const rendererUrl = yield* Config.URL('RIPTIDE_ELECTRON_RENDERER_URL').pipe(Config.withDefault(defaultRendererUrl))
	const applicationIconPath = yield* Config.String('DEVSTACK_NATIVE_ICON').pipe(
		Config.option,
		Config.map(Option.getOrUndefined),
	)
	const testMode = yield* Config.Boolean('RIPTIDE_ELECTRON_TEST').pipe(Config.withDefault(false))
	const disableCdp = yield* Config.Boolean('RIPTIDE_ELECTRON_DISABLE_CDP').pipe(Config.withDefault(false))
	const remoteDebuggingPort = yield* Config.Port('RIPTIDE_ELECTRON_CDP_PORT').pipe(Config.withDefault(9222))
	const now = yield* Clock.currentTimeMillis
	const daemonMode = yield* Config.Literals(['external', 'staged', 'packaged'], 'RIPTIDE_ELECTRON_DAEMON_MODE').pipe(
		Config.withDefault(platform.isPackaged ? ('packaged' as const) : ('external' as const)),
	)
	const stagedDaemonPath = yield* Config.String('RIPTIDE_ELECTRON_STAGED_DAEMON_PATH').pipe(
		Config.option,
		Config.map(Option.getOrUndefined),
	)
	const devstackId = yield* Config.String('DEVSTACK_ID').pipe(Config.option, Config.map(Option.getOrUndefined))

	return {
		channel,
		isPackaged: platform.isPackaged,
		userDataPath,
		homeDirectory: platform.homeDirectory,
		devstackId,
		rendererUrl,
		applicationIconPath,
		remoteDebuggingPort,
		cdpEnabled: !platform.isPackaged && !disableCdp,
		openDevTools: !platform.isPackaged && !testMode,
		logPath: pathService.join(
			platform.homeDirectory,
			'.humanlayer',
			'electrondata',
			devstackId ? `${channel}-${devstackId}` : channel,
			'logs',
			`electron-${channel}-${logTimestamp(now)}.log`,
		),
		daemonMode,
		stagedDaemonPath,
		protocolSchemes: protocolSchemesByChannel[channel],
	}
})
