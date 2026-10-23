import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, Layer, Path, Stream } from 'effect'
import { expect } from 'vitest'

import { loadElectronConfig } from '../src/config/electron-config'
import { EditorEnvironmentService, EditorEnvironmentServiceLive } from '../src/editor/editor-environment-service'
import { ElectronPlatform } from '../src/platform/electron-platform.service'
import { InheritedEnvironment } from '../src/platform/inherited-environment'
import { makeNativeEnvironmentLayer, makeNativeScalarConfigLayer } from '../src/platform/native-environment.layer'
import { configuredWindowDragSupport } from '../src/platform/window-drag'

const editorFrom = (environment: Record<string, unknown>) =>
	EditorEnvironmentService.use((service) => service.get).pipe(
		Effect.provide(
			EditorEnvironmentServiceLive.pipe(
				Layer.provide(
					ConfigProvider.layer(ConfigProvider.fromUnknown(environment, { preserveEmptyStrings: true })),
				),
			),
		),
	)

describe('environment providers', () => {
	it.effect('isolates editor providers and distinguishes absent from explicitly empty EDITOR', () =>
		Effect.gen(function* () {
			const results = yield* Effect.all(
				[
					editorFrom({ EDITOR: 'code', VISUAL: 'vim' }),
					editorFrom({ VISUAL: 'vim' }),
					editorFrom({}),
					editorFrom({ EDITOR: '', VISUAL: 'vim' }),
					editorFrom({ VISUAL: '' }),
					editorFrom({ EDITOR: 'nano', VISUAL: { invalid: true } }),
				],
				{ concurrency: 'unbounded' },
			)
			expect(results).toEqual(['code', 'vim', null, '', '', 'nano'])
		}),
	)

	it.effect('does not consult VISUAL when EDITOR is present', () => {
		const provider = ConfigProvider.layer(
			ConfigProvider.make((path) =>
				path.join('.') === 'EDITOR'
					? Effect.succeed(ConfigProvider.makeValue('nano'))
					: Effect.fail(new ConfigProvider.SourceError({ message: 'VISUAL must not be read' })),
			),
		)
		return Effect.gen(function* () {
			expect(yield* EditorEnvironmentService.use((service) => service.get)).toBe('nano')
		}).pipe(Effect.provide(EditorEnvironmentServiceLive.pipe(Layer.provide(provider))))
	})

	it.effect('keeps provider failures in the typed error channel', () =>
		Effect.gen(function* () {
			const provider = ConfigProvider.layer(
				ConfigProvider.make(() => Effect.fail(new ConfigProvider.SourceError({ message: 'Unavailable' }))),
			)
			const error = yield* EditorEnvironmentService.use((service) => service.get).pipe(
				Effect.provide(EditorEnvironmentServiceLive.pipe(Layer.provide(provider))),
				Effect.flip,
			)
			expect(error).toMatchObject({ _tag: 'EditorEnvironmentError' })
		}),
	)

	it.effect('samples native records lazily, retains unknown keys, and reads editor values at each get', () => {
		const environment: Record<string, string | undefined> = {
			EDITOR: 'first',
			UNKNOWN_INHERITED_KEY: 'keep',
			MISSING: undefined,
		}
		let reads = 0
		const native = makeNativeEnvironmentLayer(() => {
			reads++
			return environment
		})
		expect(reads).toBe(0)
		return Effect.gen(function* () {
			const inherited = yield* InheritedEnvironment
			const editor = yield* EditorEnvironmentService
			expect(yield* editor.get).toBe('first')
			const first = yield* inherited.snapshot
			expect(first).toEqual({ EDITOR: 'first', UNKNOWN_INHERITED_KEY: 'keep' })
			yield* Effect.sync(() => {
				environment.EDITOR = ''
				environment.ADDED_LATER = 'new'
			})
			expect(yield* editor.get).toBe('')
			expect(yield* inherited.snapshot).toEqual({ EDITOR: '', UNKNOWN_INHERITED_KEY: 'keep', ADDED_LATER: 'new' })
			expect(first.EDITOR).toBe('first')
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					native,
					EditorEnvironmentServiceLive.pipe(Layer.provide(makeNativeScalarConfigLayer(() => environment))),
				),
			),
		)
	})

	it.effect('samples drag configuration per operation with missing, empty, Wayland, and X11 behavior', () => {
		const environment: Record<string, string | undefined> = {}
		return Effect.gen(function* () {
			const support = configuredWindowDragSupport({ platform: 'linux', ozonePlatform: '' })
			expect(yield* support).toBe(true)
			yield* Effect.sync(() => {
				environment.XDG_SESSION_TYPE = ''
				environment.WAYLAND_DISPLAY = ''
			})
			expect(yield* support).toBe(true)
			yield* Effect.sync(() => {
				environment.XDG_SESSION_TYPE = 'wayland'
			})
			expect(yield* support).toBe(false)
			expect(yield* configuredWindowDragSupport({ platform: 'linux', ozonePlatform: 'x11' })).toBe(true)
			expect(yield* configuredWindowDragSupport({ platform: 'darwin', ozonePlatform: '' })).toBe(true)
			yield* Effect.sync(() => {
				environment.XDG_SESSION_TYPE = 'x11'
				environment.WAYLAND_DISPLAY = 'wayland-0'
			})
			expect(yield* support).toBe(false)
		}).pipe(Effect.provide(makeNativeScalarConfigLayer(() => environment)))
	})

	it.effect(
		'keeps empty startup defaults and the ambient provider unchanged while EDITOR stays empty and live',
		() => {
			const environment: Record<string, string | undefined> = {
				EDITOR: '',
				VISUAL: 'vim',
				ELECTRON_CHANNEL: '',
				DEVSTACK_ID: '',
				DEVSTACK_NATIVE_ICON: '',
				RIPTIDE_ELECTRON_TEST: '',
				RIPTIDE_ELECTRON_DISABLE_CDP: '',
				RIPTIDE_ELECTRON_RENDERER_PATH: '',
				RIPTIDE_ELECTRON_RENDERER_URL: '',
				RIPTIDE_ELECTRON_CDP_PORT: '',
				RIPTIDE_ELECTRON_DAEMON_MODE: '',
				RIPTIDE_ELECTRON_STAGED_DAEMON_PATH: '',
			}
			// Reproduce fromEnv's snapshot/overlay boundary with explicit records, never globals.
			const importMetaEnvironment = { EDITOR: 'must-not-override-native-editor', DEVSTACK_ID: 'overlay-stack' }
			const startupProvider = ConfigProvider.fromEnv({ env: { ...environment, ...importMetaEnvironment } })
			const platform = Layer.succeed(
				ElectronPlatform,
				ElectronPlatform.of({
					productName: 'HumanLayerElectronDev',
					version: '0.1.0',
					isPackaged: false,
					resourcesPath: '/resources',
					preloadPath: '/preload.cjs',
					homeDirectory: '/home/test',
					userDataPath: '/profile',
					configureBeforeReady: () => Effect.void,
					whenReady: Effect.void,
					requestSingleInstanceLock: Effect.succeed(true),
					secondInstanceEvents: Stream.empty,
					quit: Effect.void,
					resolveWindowState: () => Effect.die('Window state was not expected'),
					setApplicationIcon: () => Effect.void,
					openWindow: () => Effect.die('Window was not expected'),
				}),
			)
			const editor = EditorEnvironmentServiceLive.pipe(
				Layer.provide(makeNativeScalarConfigLayer(() => environment)),
			)
			return Effect.gen(function* () {
				expect(yield* ConfigProvider.ConfigProvider).toBe(startupProvider)
				const config = yield* loadElectronConfig
				expect(config).toMatchObject({
					cdpEnabled: true,
					openDevTools: true,
					remoteDebuggingPort: 9222,
					daemonMode: 'external',
					devstackId: 'overlay-stack',
					applicationIconPath: undefined,
					stagedDaemonPath: undefined,
				})
				expect(config.rendererUrl.href).toBe('http://localhost:3000/')
				expect(yield* EditorEnvironmentService.use((service) => service.get)).toBe('')
				yield* Effect.sync(() => {
					environment.EDITOR = 'nano'
					environment.DEVSTACK_ID = 'changed-native-stack'
					environment.RIPTIDE_ELECTRON_DISABLE_CDP = 'true'
				})
				expect(yield* EditorEnvironmentService.use((service) => service.get)).toBe('nano')
				const laterConfig = yield* loadElectronConfig
				expect(laterConfig.cdpEnabled).toBe(true)
				expect(laterConfig.devstackId).toBe('overlay-stack')
				expect(yield* ConfigProvider.ConfigProvider).toBe(startupProvider)
			}).pipe(
				Effect.provide(
					Layer.mergeAll(
						platform,
						Path.layer,
						editor,
						makeNativeEnvironmentLayer(() => environment),
						ConfigProvider.layer(startupProvider),
					),
				),
			)
		},
	)
})
