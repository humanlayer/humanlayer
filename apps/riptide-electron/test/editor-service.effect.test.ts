import * as NodePath from '@effect/platform-node/NodePath'
import { describe, expect, it } from '@effect/vitest'
import { EditorAccessError } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as PlatformError from 'effect/PlatformError'
import * as Stream from 'effect/Stream'

import { ApplicationLauncher } from '../src/editor/application-launcher.service'
import { EditorService } from '../src/editor/editor-service'
import { EditorServiceLive } from '../src/editor/editor-service.layer'
import { ElectronPlatform } from '../src/platform/electron-platform.service'

const missingPath = (path: string) =>
	PlatformError.systemError({
		_tag: 'NotFound',
		module: 'FileSystem',
		method: 'access',
		pathOrDescriptor: path,
	})

const electronPlatform = Layer.succeed(
	ElectronPlatform,
	ElectronPlatform.of({
		productName: 'HumanLayerElectronDev',
		version: '0.1.0',
		isPackaged: false,
		resourcesPath: '/resources',
		preloadPath: '/app/preload.cjs',
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
)

describe('EditorService', () => {
	it.effect('opens a file with an installed editor through the launcher service', () => {
		const launches: Array<{ readonly path: string; readonly applicationName: string | null }> = []
		const fileSystem = FileSystem.layerNoop({
			access: (path) =>
				path === '/work/file.ts' || path === '/Applications/Cursor.app'
					? Effect.void
					: Effect.fail(missingPath(path)),
		})
		const launcher = Layer.succeed(
			ApplicationLauncher,
			ApplicationLauncher.of({
				openPath: (input) =>
					Effect.sync(() => {
						launches.push(input)
					}),
			}),
		)
		const layer = EditorServiceLive.pipe(
			Layer.provide(Layer.mergeAll(fileSystem, NodePath.layer, electronPlatform, launcher)),
		)

		return Effect.gen(function* () {
			const editorService = yield* EditorService
			yield* editorService.open({ path: '/work/file.ts', editor: 'cursor' })

			expect(launches).toEqual([{ path: '/work/file.ts', applicationName: 'Cursor' }])
		}).pipe(Effect.provide(layer))
	})

	it.effect('expands home paths and opens images with the system application', () => {
		const launches: Array<{ readonly path: string; readonly applicationName: string | null }> = []
		const fileSystem = FileSystem.layerNoop({ access: () => Effect.void })
		const launcher = Layer.succeed(
			ApplicationLauncher,
			ApplicationLauncher.of({
				openPath: (input) =>
					Effect.sync(() => {
						launches.push(input)
					}),
			}),
		)
		const layer = EditorServiceLive.pipe(
			Layer.provide(Layer.mergeAll(fileSystem, NodePath.layer, electronPlatform, launcher)),
		)

		return Effect.gen(function* () {
			const editorService = yield* EditorService
			yield* editorService.open({ path: '~/screenshots/image.png', editor: 'zed' })

			expect(launches).toEqual([{ path: '/Users/test/screenshots/image.png', applicationName: null }])
		}).pipe(Effect.provide(layer))
	})

	it.effect('preserves unexpected filesystem failures as typed access errors', () => {
		const permissionFailure = PlatformError.systemError({
			_tag: 'PermissionDenied',
			module: 'FileSystem',
			method: 'access',
			pathOrDescriptor: '/work/private.ts',
			description: 'denied by test filesystem',
		})
		const fileSystem = FileSystem.layerNoop({ access: () => Effect.fail(permissionFailure) })
		const launcher = Layer.succeed(
			ApplicationLauncher,
			ApplicationLauncher.of({ openPath: () => Effect.die('launcher was not expected') }),
		)
		const layer = EditorServiceLive.pipe(
			Layer.provide(Layer.mergeAll(fileSystem, NodePath.layer, electronPlatform, launcher)),
		)

		return Effect.gen(function* () {
			const editorService = yield* EditorService
			const error = yield* Effect.flip(editorService.open({ path: '/work/private.ts', editor: null }))

			expect(error).toStrictEqual(
				new EditorAccessError({ path: '/work/private.ts', message: permissionFailure.message }),
			)
		}).pipe(Effect.provide(layer))
	})
})
