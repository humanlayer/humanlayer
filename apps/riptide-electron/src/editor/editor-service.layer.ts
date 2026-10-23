import {
	EditorAccessError,
	EditorLaunchError,
	EditorNotInstalledError,
	PathNotFoundError,
	type Editor,
} from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'

import { Sentry } from '../instrument'
import { ElectronPlatform } from '../platform/electron-platform.service'
import { ApplicationLauncher } from './application-launcher.service'
import { EditorService } from './editor-service'

const editorApplications: Record<Editor, { readonly name: string; readonly website: string }> = {
	cursor: { name: 'Cursor', website: 'cursor.sh' },
	code: { name: 'Visual Studio Code', website: 'code.visualstudio.com' },
	zed: { name: 'Zed', website: 'zed.dev' },
}

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff', '.tif'])

export const EditorServiceLive = Layer.effect(
	EditorService,
	Effect.gen(function* () {
		const applicationLauncher = yield* ApplicationLauncher
		const fileSystem = yield* FileSystem.FileSystem
		const pathService = yield* Path.Path
		const platform = yield* ElectronPlatform

		const expandTilde = (inputPath: string): string => {
			if (inputPath === '~') return platform.homeDirectory
			return inputPath.startsWith('~/') ? pathService.join(platform.homeDirectory, inputPath.slice(2)) : inputPath
		}

		const ensurePathExists = (inputPath: string) =>
			fileSystem.access(inputPath).pipe(
				Effect.catchTag('PlatformError', (error) =>
					Match.value(error.reason).pipe(
						Match.when({ _tag: 'NotFound' }, () =>
							Effect.fail(
								new PathNotFoundError({
									path: inputPath,
									message: `Directory does not exist: ${inputPath}`,
								}),
							),
						),
						Match.orElse(() =>
							Effect.logError(error).pipe(
								Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
								Effect.andThen(
									Effect.fail(new EditorAccessError({ path: inputPath, message: error.message })),
								),
							),
						),
					),
				),
			)

		const ensureEditorInstalled = (editor: Editor) => {
			const application = editorApplications[editor]
			const locations = [
				pathService.join('/Applications', `${application.name}.app`),
				pathService.join(platform.homeDirectory, 'Applications', `${application.name}.app`),
				pathService.join('/System/Applications', `${application.name}.app`),
			]

			const checkLocation = (index: number): Effect.Effect<void, EditorNotInstalledError | EditorAccessError> => {
				const location = locations[index]
				if (location === undefined) {
					return Effect.fail(
						new EditorNotInstalledError({
							editor,
							message: `${application.name} is not installed. Please install it from https://${application.website}`,
						}),
					)
				}

				return fileSystem.access(location).pipe(
					Effect.catchTag('PlatformError', (error) =>
						Match.value(error.reason).pipe(
							Match.when({ _tag: 'NotFound' }, () => checkLocation(index + 1)),
							Match.orElse(() =>
								Effect.logError(error).pipe(
									Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
									Effect.andThen(
										Effect.fail(new EditorAccessError({ path: location, message: error.message })),
									),
								),
							),
						),
					),
				)
			}

			return checkLocation(0)
		}

		const open = Effect.fn('editor.open')(function* (input: {
			readonly path: string
			readonly editor: Editor | null
		}) {
			const expandedPath = expandTilde(input.path)
			const isImage = imageExtensions.has(pathService.extname(expandedPath).toLowerCase())
			const selectedEditor = isImage ? null : input.editor

			yield* ensurePathExists(expandedPath)
			if (selectedEditor !== null) yield* ensureEditorInstalled(selectedEditor)
			yield* applicationLauncher
				.openPath({
					path: expandedPath,
					applicationName: selectedEditor === null ? null : editorApplications[selectedEditor].name,
				})
				.pipe(
					Effect.tapError((e) => Effect.logError(e)),
					Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
					Effect.mapError(
						(error) =>
							new EditorLaunchError({
								message: error.message,
							}),
					),
				)
		})

		return EditorService.of({ open })
	}),
)
