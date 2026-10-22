import { WorkspaceConfigError, type WorkspaceConfigTarget } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'

import { EditorService } from '../editor/editor-service'
import { ElectronPlatform } from '../platform/electron-platform.service'
import { RepositoryDiscoveryService } from '../repository-discovery/repository-discovery.service'
import { WorkspaceConfigService } from './workspace-config-service'

const LOCAL_CONFIG_ENTRY = '.humanlayer/workspace.local.json'

export const WorkspaceConfigServiceLive = Layer.effect(
	WorkspaceConfigService,
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		const pathService = yield* Path.Path
		const platform = yield* ElectronPlatform
		const editorService = yield* EditorService
		const repositoryDiscovery = yield* RepositoryDiscoveryService

		const expandPath = (value: string) => {
			if (value === '~') return platform.homeDirectory
			return value.startsWith('~/') ? pathService.join(platform.homeDirectory, value.slice(2)) : value
		}
		const configPath = (directory: string, target: WorkspaceConfigTarget) =>
			pathService.join(
				expandPath(directory),
				'.humanlayer',
				target === 'repo' ? 'workspace.json' : 'workspace.local.json',
			)
		const fail = (operation: string, path: string, error: unknown) =>
			new WorkspaceConfigError({
				operation,
				path,
				message: error instanceof Error ? error.message : String(error),
			})

		const read = Effect.fn('workspace_config.read')(function* (input: {
			readonly directory: string
			readonly target: WorkspaceConfigTarget
		}) {
			const path = configPath(input.directory, input.target)
			const result = yield* fileSystem.readFileString(path, 'utf8').pipe(
				Effect.map((content) => ({ content, exists: true })),
				Effect.catchReason(
					'PlatformError',
					'NotFound',
					() => Effect.succeed({ content: null, exists: false }),
					(_reason, error) => Effect.fail(fail('read', path, error)),
				),
			)
			if (input.target === 'local') return result
			const repositoryContext = yield* repositoryDiscovery.inspectSelected({
				directory: expandPath(input.directory),
			})
			return {
				...result,
				...repositoryContext,
			}
		})

		const write = Effect.fn('workspace_config.write')(function* (input: {
			readonly directory: string
			readonly target: WorkspaceConfigTarget
			readonly content: string
		}) {
			const path = configPath(input.directory, input.target)
			yield* fileSystem.makeDirectory(pathService.dirname(path), { recursive: true }).pipe(
				Effect.andThen(fileSystem.writeFileString(path, input.content)),
				Effect.mapError((error) => fail('write', path, error)),
			)
		})

		const ensureIgnored = Effect.fn('workspace_config.ensure_ignored')(function* (directory: string) {
			const path = pathService.join(expandPath(directory), '.gitignore')
			const current = yield* fileSystem.readFileString(path, 'utf8').pipe(
				Effect.catchReason(
					'PlatformError',
					'NotFound',
					() => Effect.succeed(''),
					(_reason, error) => Effect.fail(fail('read_gitignore', path, error)),
				),
			)
			if (current.split(/\r?\n/u).some((line) => line.trim() === LOCAL_CONFIG_ENTRY)) return
			const prefix = current.length === 0 || current.endsWith('\n') ? current : `${current}\n`
			yield* fileSystem
				.writeFileString(path, `${prefix}${LOCAL_CONFIG_ENTRY}\n`)
				.pipe(Effect.mapError((error) => fail('write_gitignore', path, error)))
		})

		const open = Effect.fn('workspace_config.open')(function* (input: {
			readonly directory: string
			readonly target: WorkspaceConfigTarget
			readonly previewContent: string
			readonly editor?: 'cursor' | 'code' | 'zed'
		}) {
			const path = configPath(input.directory, input.target)
			const existing = yield* read(input)
			if (!existing.exists) yield* write({ ...input, content: input.previewContent })
			yield* editorService
				.open({ path, editor: input.editor ?? null })
				.pipe(Effect.mapError((error) => fail('open', path, error)))
		})

		return WorkspaceConfigService.of({ read, write, ensureIgnored, open })
	}),
)
