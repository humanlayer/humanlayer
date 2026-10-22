import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { useHermeticGitConfig } from '@humanlayer/git-attribution/testing'
import { afterAll, describe, expect, test } from 'vitest'

import { getArtifactStoragePath, isGitRepository, setupArtifactPaths } from '../../../src/lib/artifact-paths'
import { createMockDaemonServices } from '../../helpers/create-mock-daemon-services'

const execFileAsync = promisify(execFile)
const createdTaskIds: string[] = []
const createdTempDirectories: string[] = []
const daemonRuntime = createMockDaemonServices().daemonRuntime

useHermeticGitConfig()

function uniqueTaskId(): string {
	const taskId = `test-gitignore-${crypto.randomUUID()}`
	createdTaskIds.push(taskId)
	return taskId
}

async function tempDir(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'artifact-paths-gitignore-'))
	createdTempDirectories.push(directory)
	return directory
}

async function runGit(cwd: string, ...args: string[]): Promise<void> {
	await execFileAsync('git', args, { cwd })
}

async function initRepository(): Promise<string> {
	const cwd = await tempDir()
	await runGit(cwd, 'init', '--quiet')
	await runGit(cwd, 'config', 'user.email', 'riptide-tests@example.com')
	await runGit(cwd, 'config', 'user.name', 'Riptide Tests')
	return cwd
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path)
		return true
	} catch {
		return false
	}
}

afterAll(async () => {
	await daemonRuntime.dispose()
	await Promise.all([
		...createdTaskIds.map((taskId) => rm(getArtifactStoragePath(taskId), { recursive: true, force: true })),
		...createdTempDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
	])
})

describe('isGitRepository', () => {
	test('true for a .git directory (normal clone)', async () => {
		const cwd = await tempDir()
		await mkdir(join(cwd, '.git'))
		expect(await isGitRepository(cwd)).toBe(true)
	})

	test('true for a .git file (linked worktree)', async () => {
		const cwd = await tempDir()
		await writeFile(join(cwd, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n', 'utf-8')
		expect(await isGitRepository(cwd)).toBe(true)
	})

	test('false for a plain directory (workspace root)', async () => {
		const cwd = await tempDir()
		expect(await isGitRepository(cwd)).toBe(false)
	})
})

describe('setupArtifactPaths gitignore handling', () => {
	test('leaves a root .gitignore rule unchanged', async () => {
		const cwd = await initRepository()
		const gitignorePath = join(cwd, '.gitignore')
		const originalContents = '.humanlayer/tasks/\n'
		await writeFile(gitignorePath, originalContents)

		await setupArtifactPaths(cwd, uniqueTaskId(), 'root-rule-task', daemonRuntime)

		expect(await readFile(gitignorePath, 'utf-8')).toBe(originalContents)
	})

	test('leaves .gitignore absent when info/exclude ignores artifacts', async () => {
		const cwd = await initRepository()
		await writeFile(join(cwd, '.git', 'info', 'exclude'), '.humanlayer/tasks/\n')

		await setupArtifactPaths(cwd, uniqueTaskId(), 'info-exclude-task', daemonRuntime)

		expect(await fileExists(join(cwd, '.gitignore'))).toBe(false)
	})

	test('leaves .gitignore absent when core.excludesFile ignores artifacts', async () => {
		const cwd = await initRepository()
		const excludesFile = join(await tempDir(), 'git-excludes')
		await writeFile(excludesFile, '.humanlayer/tasks/\n')
		await runGit(cwd, 'config', 'core.excludesFile', excludesFile)

		await setupArtifactPaths(cwd, uniqueTaskId(), 'configured-exclude-task', daemonRuntime)

		expect(await fileExists(join(cwd, '.gitignore'))).toBe(false)
	})

	test('honors a matching rule when an artifact path is tracked', async () => {
		const cwd = await initRepository()
		const gitignorePath = join(cwd, '.gitignore')
		const originalContents = '.humanlayer/tasks/\n'
		await mkdir(join(cwd, '.humanlayer', 'tasks'), { recursive: true })
		await writeFile(join(cwd, '.humanlayer', 'tasks', 'tracked.txt'), 'tracked\n')
		await writeFile(gitignorePath, originalContents)
		await runGit(cwd, 'add', '--force', '.humanlayer/tasks/tracked.txt')

		await setupArtifactPaths(cwd, uniqueTaskId(), 'tracked-path-task', daemonRuntime)

		expect(await readFile(gitignorePath, 'utf-8')).toBe(originalContents)
	})

	test('appends the Riptide rule after an effective negation', async () => {
		const cwd = await initRepository()
		const gitignorePath = join(cwd, '.gitignore')
		const originalContents = '.humanlayer/tasks/\n!.humanlayer/tasks/\n'
		await writeFile(gitignorePath, originalContents)

		await setupArtifactPaths(cwd, uniqueTaskId(), 'negated-rule-task', daemonRuntime)

		expect(await readFile(gitignorePath, 'utf-8')).toBe(
			`${originalContents}\n# Riptide artifacts (cloud-synced)\n.humanlayer/tasks/\n`,
		)
	})

	test('appends the Riptide rule when no effective rule matches', async () => {
		const cwd = await initRepository()

		await setupArtifactPaths(cwd, uniqueTaskId(), 'unignored-task', daemonRuntime)

		expect(await readFile(join(cwd, '.gitignore'), 'utf-8')).toBe(
			'\n# Riptide artifacts (cloud-synced)\n.humanlayer/tasks/\n',
		)
	})

	test('does not append a second block on repeated setup', async () => {
		const cwd = await initRepository()
		const taskId = uniqueTaskId()

		await setupArtifactPaths(cwd, taskId, 'repeat-task', daemonRuntime)
		await setupArtifactPaths(cwd, taskId, 'repeat-task', daemonRuntime)

		const gitignore = await readFile(join(cwd, '.gitignore'), 'utf-8')
		expect(gitignore.match(/# Riptide artifacts \(cloud-synced\)/g)).toHaveLength(1)
	})

	test('uses effective ignore rules in a linked worktree', async () => {
		const root = await tempDir()
		const repository = join(root, 'repository')
		const worktree = join(root, 'linked-worktree')
		await mkdir(repository)
		await runGit(repository, 'init', '--quiet')
		await runGit(repository, 'config', 'user.email', 'riptide-tests@example.com')
		await runGit(repository, 'config', 'user.name', 'Riptide Tests')
		await writeFile(join(repository, 'README.md'), 'repository\n')
		await runGit(repository, 'add', 'README.md')
		await runGit(repository, 'commit', '--quiet', '-m', 'initial commit')
		await runGit(repository, 'worktree', 'add', '--quiet', '-b', 'linked-test', worktree)
		const gitignorePath = join(worktree, '.gitignore')
		const originalContents = '.humanlayer/tasks/\n'
		await writeFile(gitignorePath, originalContents)

		await setupArtifactPaths(worktree, uniqueTaskId(), 'linked-worktree-task', daemonRuntime)

		expect(await readFile(gitignorePath, 'utf-8')).toBe(originalContents)
	})

	test('keeps the symlink usable and skips .gitignore after a fatal Git check', async () => {
		const cwd = await tempDir()
		await writeFile(join(cwd, '.git'), 'not a valid gitdir file\n')

		const { symlinkPath } = await setupArtifactPaths(cwd, uniqueTaskId(), 'fatal-git-task', daemonRuntime)

		expect(await fileExists(symlinkPath)).toBe(true)
		expect(await fileExists(join(cwd, '.gitignore'))).toBe(false)
	})

	test('skips .gitignore when the cwd is not a git repo (workspace root launch)', async () => {
		const cwd = await tempDir()

		const { symlinkPath } = await setupArtifactPaths(cwd, uniqueTaskId(), 'workspace-root-task', daemonRuntime)

		expect(await fileExists(symlinkPath)).toBe(true)
		expect(await fileExists(join(cwd, '.gitignore'))).toBe(false)
	})
})
