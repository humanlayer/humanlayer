import {
	DownloadCompleted,
	DownloadFailed,
	DownloadProgress,
	type UpdateEvent,
	type UpdateInfo as RpcUpdateInfo,
} from '@humanlayer/riptide-electron-rpc'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as PubSub from 'effect/PubSub'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'
import { autoUpdater, type UpdateInfo as NativeUpdateInfo } from 'electron-updater'

import { resolveChannel } from '../config/electron-channel'
import { updaterConfigByChannel } from '../config/electron-config'
import { Sentry } from '../instrument'
import { ElectronPlatform } from '../platform/electron-platform.service'
import {
	UpdateCheckError,
	UpdateDownloadError,
	UpdateNotAvailableError,
	UpdateNotReadyError,
} from './electron-updater.errors'
import { UpdateState } from './electron-updater.schemas'
import { ElectronUpdaterService, type ElectronUpdaterServiceShape } from './electron-updater.service'
import { isUpdateAvailable } from './update-check-result'

function toPlainObject(value: NativeUpdateInfo): Record<string, unknown> {
	return JSON.parse(JSON.stringify(value))
}

function mapUpdateInfo(raw: NativeUpdateInfo): RpcUpdateInfo {
	const notes =
		typeof raw.releaseNotes === 'string'
			? raw.releaseNotes
			: Array.isArray(raw.releaseNotes)
				? raw.releaseNotes.map((n) => (typeof n === 'string' ? n : (n.note ?? ''))).join('\n')
				: ''
	return {
		version: raw.version,
		notes,
		urgency: 'normal',
		rawJson: toPlainObject(raw),
	}
}

export const ElectronUpdaterServiceLive = Layer.effect(
	ElectronUpdaterService,
	Effect.gen(function* () {
		const platform = yield* ElectronPlatform
		const environmentChannel = yield* Config.String('ELECTRON_CHANNEL').pipe(Config.option)
		const channel = resolveChannel({
			isPackaged: platform.isPackaged,
			productName: platform.productName,
			environmentChannel: Option.getOrUndefined(environmentChannel),
		})
		const updaterUrlOverride = yield* Config.String('RIPTIDE_UPDATER_URL').pipe(
			Config.option,
			Config.map(Option.getOrUndefined),
		)
		const updateServerUrl = updaterUrlOverride ?? updaterConfigByChannel[channel].url

		const state = yield* Ref.make<UpdateState>(UpdateState.Idle())
		const progressPubSub = yield* PubSub.unbounded<UpdateEvent>()

		autoUpdater.autoDownload = false
		autoUpdater.autoInstallOnAppQuit = false
		autoUpdater.setFeedURL({ provider: 'generic', url: updateServerUrl })
		autoUpdater.logger = null

		autoUpdater.on('download-progress', (info) => {
			Effect.runFork(
				PubSub.publish(
					progressPubSub,
					DownloadProgress.make({
						bytesPerSecond: info.bytesPerSecond,
						percent: info.percent,
						delta: info.delta,
						transferred: info.transferred,
						total: info.total,
					}),
				).pipe(
					Effect.tapError((e) =>
						Effect.logError('Failed to publish download progress').pipe(Effect.annotateLogs({ error: e })),
					),
				),
			)
		})

		autoUpdater.on('update-downloaded', (event) => {
			const mapped = mapUpdateInfo(event)
			Effect.runFork(
				Ref.set(state, UpdateState.Downloaded({ info: mapped })).pipe(
					Effect.andThen(PubSub.publish(progressPubSub, DownloadCompleted.make({ version: event.version }))),
					Effect.tapError((e) =>
						Effect.logError('Failed to handle update-downloaded').pipe(Effect.annotateLogs({ error: e })),
					),
				),
			)
		})

		autoUpdater.on('error', (error) => {
			Sentry.captureException(error)
			Effect.runFork(
				Effect.logError('electron-updater error').pipe(
					Effect.annotateLogs({ error: error.message }),
					Effect.andThen(
						Ref.get(state).pipe(
							Effect.flatMap((current) =>
								UpdateState.$is('Downloading')(current)
									? Ref.set(state, UpdateState.UpdateAvailable({ info: current.info })).pipe(
											Effect.andThen(
												PubSub.publish(
													progressPubSub,
													DownloadFailed.make({ message: error.message }),
												),
											),
										)
									: Effect.void,
							),
						),
					),
				),
			)
		})

		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				autoUpdater.removeAllListeners()
			}),
		)

		const checkForAppUpdate: ElectronUpdaterServiceShape['checkForAppUpdate'] = () =>
			Effect.tryPromise({
				try: () => autoUpdater.checkForUpdates(),
				catch: (cause) => new UpdateCheckError({ message: String(cause) }),
			}).pipe(
				Effect.flatMap((result) => {
					if (!isUpdateAvailable(result)) return Effect.succeed(null)
					const mapped = mapUpdateInfo(result.updateInfo)
					return Ref.set(state, UpdateState.UpdateAvailable({ info: mapped })).pipe(Effect.as(mapped))
				}),
				Effect.tapError((error) =>
					Effect.logError('Update check failed').pipe(
						Effect.annotateLogs({ error }),
						Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
					),
				),
				Effect.withSpan('electron_updater.check_for_app_update'),
			)

		const downloadAvailableUpdate: ElectronUpdaterServiceShape['downloadAvailableUpdate'] = () =>
			Ref.get(state).pipe(
				Effect.flatMap((current) =>
					Match.value(current).pipe(
						Match.tagsExhaustive({
							Idle: () =>
								Effect.fail(
									new UpdateNotAvailableError({
										message: 'No update available. Call checkForAppUpdate first.',
									}),
								),
							UpdateAvailable: ({ info }) =>
								Ref.set(state, UpdateState.Downloading({ info })).pipe(
									Effect.andThen(
										Effect.tryPromise({
											try: () => autoUpdater.downloadUpdate(),
											catch: (cause) => new UpdateDownloadError({ message: String(cause) }),
										}),
									),
									Effect.asVoid,
								),
							Downloading: () => Effect.void,
							Downloaded: () => Effect.void,
						}),
					),
				),
				Effect.tapError((error) =>
					Effect.logError('Update download failed').pipe(
						Effect.annotateLogs({ error }),
						Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
					),
				),
				Effect.withSpan('electron_updater.download_available_update'),
			)

		const quitAndInstallUpdate: ElectronUpdaterServiceShape['quitAndInstallUpdate'] = () =>
			Ref.get(state).pipe(
				Effect.flatMap((current) =>
					Match.value(current).pipe(
						Match.tagsExhaustive({
							Idle: () =>
								Effect.fail(
									new UpdateNotReadyError({
										message: 'No update downloaded. Download must complete first.',
									}),
								),
							UpdateAvailable: () =>
								Effect.fail(new UpdateNotReadyError({ message: 'Update not yet downloaded.' })),
							Downloading: () =>
								Effect.fail(new UpdateNotReadyError({ message: 'Download still in progress.' })),
							Downloaded: () =>
								Effect.sync(() => {
									autoUpdater.quitAndInstall()
								}).pipe(Effect.andThen(Effect.never)),
						}),
					),
				),
				Effect.tapError((error) =>
					Effect.logError('Quit and install failed').pipe(
						Effect.annotateLogs({ error }),
						Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
					),
				),
				Effect.withSpan('electron_updater.quit_and_install_update'),
			)

		return ElectronUpdaterService.of({
			checkForAppUpdate: () => checkForAppUpdate(),
			downloadAvailableUpdate: () => downloadAvailableUpdate(),
			downloadProgress: Stream.fromPubSub(progressPubSub),
			quitAndInstallUpdate: () => quitAndInstallUpdate(),
		})
	}),
)
