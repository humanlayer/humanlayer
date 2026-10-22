import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Cause, ConfigProvider, Effect, Layer } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import { describe, expect, test } from 'vitest'

import {
	createCachedBinaryLocator,
	detectBinaryPath,
	detectBinaryPathEffect,
	detectViaCommonPaths,
	detectViaLoginShell,
	detectViaNvm,
	detectViaWhich,
	expandHome,
	isExecutable,
	shouldSkipPath,
} from '../../src/lib/binary-detection'
import { allocateTempDir, releaseTempDir } from '../helpers/concurrency'

function createFsError(code: string, message = code) {
	return Object.assign(new Error(message), { code })
}

const liveBinaryDetectionLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer)

const runLiveBinaryDetection = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
	Effect.runPromise(effect.pipe(Effect.provide(liveBinaryDetectionLayer)))

function createTestLayers(options: { executablePaths?: string[]; statErrors?: Record<string, unknown> } = {}) {
	const executablePaths = new Set(options.executablePaths ?? [])
	const statErrors = options.statErrors ?? {}
	const fsLayer = FileSystem.layerNoop({
		stat: (path) => {
			const error = statErrors[path]
			if (error) return Effect.fail(error as any)
			if (executablePaths.has(path)) return Effect.succeed({ type: 'File', mode: 0o755 } as FileSystem.File.Info)
			return Effect.fail(createFsError('ENOENT') as any)
		},
	})

	return { layer: Layer.merge(fsLayer, Path.layer) }
}

async function withTempDir<T>(prefix: string, fn: (testDir: string) => Promise<T>): Promise<T> {
	const testDir = allocateTempDir(prefix)
	try {
		await mkdir(testDir, { recursive: true })
		return await fn(testDir)
	} finally {
		await rm(testDir, { recursive: true, force: true })
		releaseTempDir(testDir)
	}
}

function createTestEnvVarName(prefix: string): string {
	return `${prefix}_${crypto.randomUUID().replace(/-/g, '_').toUpperCase()}`
}

describe('expandHome', () => {
	test('expands ~ to home directory', () => {
		expect(Effect.runSync(expandHome('~/bin/test').pipe(Effect.provide(Path.layer)))).toBe(
			join(homedir(), 'bin/test'),
		)
	})

	test('leaves paths without ~ unchanged', () => {
		expect(Effect.runSync(expandHome('/usr/local/bin/test').pipe(Effect.provide(Path.layer)))).toBe(
			'/usr/local/bin/test',
		)
	})

	test('leaves relative paths unchanged', () => {
		expect(Effect.runSync(expandHome('bin/test').pipe(Effect.provide(Path.layer)))).toBe('bin/test')
	})

	test('only expands ~ at the start', () => {
		expect(Effect.runSync(expandHome('/home/user/~test').pipe(Effect.provide(Path.layer)))).toBe('/home/user/~test')
	})
})

describe('shouldSkipPath', () => {
	test('skips paths containing node_modules', () => {
		expect(shouldSkipPath('/home/user/project/node_modules/.bin/claude')).toBe(true)
		expect(shouldSkipPath('/node_modules/claude')).toBe(true)
	})

	test('skips paths ending with .bak', () => {
		expect(shouldSkipPath('/usr/local/bin/claude.bak')).toBe(true)
	})

	test('allows valid paths', () => {
		expect(shouldSkipPath('/usr/local/bin/claude')).toBe(false)
		expect(shouldSkipPath('/home/user/.local/bin/claude')).toBe(false)
	})
})

describe('isExecutable', () => {
	test('returns true for executable files', async () => {
		await withTempDir('binary-detection-test', async (testDir) => {
			const executablePath = join(testDir, 'executable')
			await writeFile(executablePath, '#!/bin/bash\necho "test"', { mode: 0o755 })
			expect(await runLiveBinaryDetection(isExecutable(executablePath))).toBe(true)
		})
	})

	test('returns false for non-executable files', async () => {
		await withTempDir('binary-detection-test', async (testDir) => {
			const nonExecutablePath = join(testDir, 'non-executable')
			await writeFile(nonExecutablePath, 'not executable', { mode: 0o644 })
			expect(await runLiveBinaryDetection(isExecutable(nonExecutablePath))).toBe(false)
		})
	})

	test('returns false for non-existent files', async () => {
		await withTempDir('binary-detection-test', async (testDir) => {
			expect(await runLiveBinaryDetection(isExecutable(join(testDir, 'does-not-exist')))).toBe(false)
		})
	})

	test('expands ~ in path', async () => {
		expect(await runLiveBinaryDetection(isExecutable('~/nonexistent-binary-12345'))).toBe(false)
	})
})

describe('detectViaWhich', () => {
	test('finds binaries in PATH', async () => {
		const result = await runLiveBinaryDetection(detectViaWhich('ls'))
		expect(result).toContain('/ls')
		expect(result).not.toContain('node_modules')
	})

	test('throws for non-existent binaries', async () => {
		await expect(runLiveBinaryDetection(detectViaWhich('nonexistent-binary-12345'))).rejects.toThrow()
	})
})

describe('detectViaCommonPaths', () => {
	test('finds binary in additional paths', async () => {
		await withTempDir('binary-detection-common', async (testDir) => {
			const binaryPath = join(testDir, 'mybin')
			await writeFile(binaryPath, '#!/bin/bash\necho "test"', { mode: 0o755 })
			const result = await runLiveBinaryDetection(
				detectViaCommonPaths({ binaryName: 'mybin', additionalPaths: [binaryPath] }),
			)
			expect(result).toBe(binaryPath)
		})
	})

	test('throws when no paths contain the binary', async () => {
		const error = await runLiveBinaryDetection(
			detectViaCommonPaths({
				binaryName: 'nonexistent-binary-12345',
				additionalPaths: [],
			}).pipe(Effect.flip),
		)
		expect(error).toMatchObject({
			_tag: 'ClaudeBinaryDetectionMethodFailed',
			method: 'common-paths',
			binaryName: 'nonexistent-binary-12345',
		})
	})

	test('skips paths in node_modules', async () => {
		await withTempDir('binary-detection-common', async (testDir) => {
			await expect(
				runLiveBinaryDetection(
					detectViaCommonPaths({
						binaryName: 'mybin',
						additionalPaths: [join(testDir, 'node_modules', '.bin', 'mybin')],
					}),
				),
			).rejects.toThrow()
		})
	})
})

describe('detectViaNvm', () => {
	test('finds binaries using the Effect filesystem', async () => {
		const nvmBase = join(homedir(), '.nvm/versions/node')
		const binaryPath = join(nvmBase, 'v22.0.0', 'bin', 'claude')
		const fsLayer = FileSystem.layerNoop({
			readDirectory: (path) =>
				path === nvmBase ? Effect.succeed(['v22.0.0']) : Effect.fail(createFsError('ENOENT') as any),
			stat: (path) =>
				path === binaryPath
					? Effect.succeed({ type: 'File', mode: 0o755 } as FileSystem.File.Info)
					: Effect.fail(createFsError('ENOENT') as any),
		})

		const result = await Effect.runPromise(
			detectViaNvm('claude').pipe(Effect.provide(Layer.merge(fsLayer, Path.layer))),
		)

		expect(result).toBe(binaryPath)
	})

	test('throws when NVM directory does not exist', async () => {
		await expect(runLiveBinaryDetection(detectViaNvm('nonexistent-binary-12345'))).rejects.toThrow()
	})
})

describe('detectViaLoginShell', () => {
	test('finds binaries available via login shell', async () => {
		const result = await runLiveBinaryDetection(detectViaLoginShell('ls'))
		expect(result).toContain('/ls')
	})

	test('throws for non-existent binaries', async () => {
		await expect(runLiveBinaryDetection(detectViaLoginShell('nonexistent-binary-12345'))).rejects.toThrow()
	})
})

describe('detectBinaryPath', () => {
	test('finds binary via environment variable first', async () => {
		await withTempDir('binary-detection-full', async (testDir) => {
			const binaryPath = join(testDir, 'mybin')
			await writeFile(binaryPath, '#!/bin/bash\necho "test"', { mode: 0o755 })
			const envVarName = createTestEnvVarName('TEST_BINARY_PATH')
			const result = await runLiveBinaryDetection(
				detectBinaryPath({ binaryName: 'mybin', envVarName, enableLogging: false }).pipe(
					Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ [envVarName]: binaryPath }))),
				),
			)
			expect(result).toBe(binaryPath)
		})
	})

	test('falls back to other methods when env var path is not executable', async () => {
		await withTempDir('binary-detection-full', async (testDir) => {
			const nonExecutable = join(testDir, 'nonexec')
			await writeFile(nonExecutable, 'not executable', { mode: 0o644 })
			const envVarName = createTestEnvVarName('TEST_BINARY_PATH')
			const result = await runLiveBinaryDetection(
				detectBinaryPath({ binaryName: 'ls', envVarName, enableLogging: false }).pipe(
					Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ [envVarName]: nonExecutable }))),
				),
			)
			expect(result).toContain('/ls')
		})
	})

	test('finds common system binaries', async () => {
		expect(await runLiveBinaryDetection(detectBinaryPath({ binaryName: 'ls', enableLogging: false }))).toContain(
			'/ls',
		)
	})

	test('returns undefined for non-existent binaries', async () => {
		expect(
			await runLiveBinaryDetection(
				detectBinaryPath({ binaryName: 'nonexistent-binary-12345', enableLogging: false }),
			),
		).toBeUndefined()
	})

	test('supports additional paths', async () => {
		await withTempDir('binary-detection-full', async (testDir) => {
			const binaryPath = join(testDir, 'custom-binary')
			await writeFile(binaryPath, '#!/bin/bash\necho "test"', { mode: 0o755 })
			const result = await runLiveBinaryDetection(
				detectBinaryPath({
					binaryName: 'custom-binary',
					additionalPaths: [binaryPath],
					enableLogging: false,
				}),
			)
			expect(result).toBe(binaryPath)
		})
	})
})

describe('detectBinaryPathEffect', () => {
	test('uses test filesystem layer and prefers ~/.local/bin before fallback paths', async () => {
		const localPath = join(homedir(), '.local/bin/claude')
		const homebrewPath = '/opt/homebrew/bin/claude'
		const { layer } = createTestLayers({ executablePaths: [localPath, homebrewPath] })

		const result = await Effect.runPromise(
			detectBinaryPathEffect({ binaryName: 'claude', enableLogging: false }).pipe(Effect.provide(layer)),
		)

		expect(result).toBe(localPath)
	})

	test('keeps searching after stat errors', async () => {
		const localPath = join(homedir(), '.local/bin/claude')
		const claudeLocalPath = join(homedir(), '.claude/local/claude')
		const { layer } = createTestLayers({
			executablePaths: [claudeLocalPath],
			statErrors: { [localPath]: createFsError('EACCES') },
		})

		const result = await Effect.runPromise(
			detectBinaryPathEffect({ binaryName: 'claude', enableLogging: false }).pipe(Effect.provide(layer)),
		)

		expect(result).toBe(claudeLocalPath)
	})

	test('fails with ClaudeCodeBinaryNotFound when no candidate exists', async () => {
		const { layer } = createTestLayers()

		const cause = await Effect.runPromise(
			detectBinaryPathEffect({ binaryName: 'claude', enableLogging: false }).pipe(
				Effect.flip,
				Effect.map((error) => Cause.squash(Cause.fail(error))),
				Effect.provide(layer),
			),
		)

		expect(cause).toMatchObject({ _tag: 'ClaudeCodeBinaryNotFound' })
	})

	test('swallows filesystem defects and keeps searching', async () => {
		const localPath = join(homedir(), '.local/bin/claude')
		const claudeLocalPath = join(homedir(), '.claude/local/claude')
		const fsLayer = FileSystem.layerNoop({
			stat: (path) => {
				if (path === localPath) return Effect.die(new Error('filesystem exploded'))
				if (path === claudeLocalPath)
					return Effect.succeed({ type: 'File', mode: 0o755 } as FileSystem.File.Info)
				return Effect.fail(createFsError('ENOENT') as any)
			},
		})
		const result = await Effect.runPromise(
			detectBinaryPathEffect({ binaryName: 'claude', enableLogging: false }).pipe(
				Effect.provide(Path.layer),
				Effect.provide(fsLayer),
			),
		)

		expect(result).toBe(claudeLocalPath)
	})
})

describe('createCachedBinaryLocator', () => {
	test('caches path after initialization', async () => {
		await withTempDir('binary-detection-cached', async (testDir) => {
			const binaryPath = join(testDir, 'cached-bin')
			await writeFile(binaryPath, '#!/bin/bash\necho "test"', { mode: 0o755 })
			const envVarName = createTestEnvVarName('TEST_CACHED_PATH')
			const provider = ConfigProvider.layer(ConfigProvider.fromUnknown({ [envVarName]: binaryPath }))
			const locator = createCachedBinaryLocator({ binaryName: 'cached-bin', envVarName })
			await runLiveBinaryDetection(locator.initialize().pipe(Effect.provide(provider)))
			expect(await runLiveBinaryDetection(locator.getPath())).toBe(binaryPath)
			expect(await runLiveBinaryDetection(locator.getPath())).toBe(binaryPath)
			expect(locator.getCachedPath()).toBe(binaryPath)
		})
	})

	test('retries detection when cache is empty', async () => {
		await withTempDir('binary-detection-cached', async (testDir) => {
			const locator = createCachedBinaryLocator({
				binaryName: 'nonexistent-at-first-12345',
				enableLogging: false,
			})
			await runLiveBinaryDetection(locator.initialize())
			expect(locator.getCachedPath()).toBeUndefined()

			const binaryPath = join(testDir, 'appeared-later')
			await writeFile(binaryPath, '#!/bin/bash\necho "test"', { mode: 0o755 })

			const locator2 = createCachedBinaryLocator({
				binaryName: 'appeared-later',
				additionalPaths: [binaryPath],
				enableLogging: false,
			})
			await runLiveBinaryDetection(locator2.initialize())
			expect(locator2.getCachedPath()).toBe(binaryPath)
		})
	})

	test('resetCache clears the cached path', async () => {
		await withTempDir('binary-detection-cached', async (testDir) => {
			const binaryPath = join(testDir, 'reset-test')
			await writeFile(binaryPath, '#!/bin/bash\necho "test"', { mode: 0o755 })
			const envVarName = createTestEnvVarName('TEST_CACHED_PATH')
			const locator = createCachedBinaryLocator({ binaryName: 'reset-test', envVarName })
			await runLiveBinaryDetection(
				locator
					.initialize()
					.pipe(
						Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ [envVarName]: binaryPath }))),
					),
			)
			expect(locator.getCachedPath()).toBe(binaryPath)
			locator.resetCache()
			expect(locator.getCachedPath()).toBeUndefined()
		})
	})

	test('getPath runs detection if initialize was not called', async () => {
		await withTempDir('binary-detection-cached', async (testDir) => {
			const binaryPath = join(testDir, 'lazy-init')
			await writeFile(binaryPath, '#!/bin/bash\necho "test"', { mode: 0o755 })
			const locator = createCachedBinaryLocator({
				binaryName: 'lazy-init',
				additionalPaths: [binaryPath],
				enableLogging: false,
			})
			expect(await runLiveBinaryDetection(locator.getPath())).toBe(binaryPath)
		})
	})
})
