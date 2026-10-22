/**
 * E2E test for rpi init and sync commands
 *
 * Tests the happy path:
 * 1. Clone e2e test repo to tmp artifacts dir
 * 2. Ensure tasks/ dir exists in artifacts
 * 3. Run `rpi init` in a tmp code repo
 * 4. Create a file in rpi/tasks/test/
 * 5. Run `rpi sync`
 * 6. Verify file is pushed to remote
 */

// E2E tests need longer timeout for git operations
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)

async function run(command: string, args: string[], cwd?: string) {
	try {
		const { stdout, stderr } = await execFileAsync(command, args, { cwd })
		return { exitCode: 0, stdout, stderr }
	} catch (error) {
		const err = error as Error & { code?: number; stdout?: string; stderr?: string }
		return { exitCode: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
	}
}

const E2E_REPO = 'humanlayer/e2e-test-rpi-artifacts'
const CLI_PATH = join(import.meta.dirname, '../../index.ts')

describe('rpi init + sync e2e', () => {
	let tempRoot: string
	let codeRepo: string
	let artifactsRepo: string
	let configFile: string

	beforeAll(async () => {
		// Create temp directories
		tempRoot = mkdtempSync(join(tmpdir(), 'rpi-e2e-'))
		codeRepo = join(tempRoot, 'code-repo')
		artifactsRepo = join(tempRoot, 'artifacts')
		configFile = join(tempRoot, 'config.json')

		mkdirSync(codeRepo, { recursive: true })

		// Initialize code repo as a git repo
		await run('git', ['init'], codeRepo)
		await run('git', ['config', 'user.email', 'test@example.com'], codeRepo)
		await run('git', ['config', 'user.name', 'E2E Test'], codeRepo)
		writeFileSync(join(codeRepo, 'README.md'), '# Test Code Repo')
		await run('git', ['add', '.'], codeRepo)
		await run('git', ['commit', '-m', 'Initial commit'], codeRepo)

		// Clone e2e artifacts repo
		await run('gh', ['repo', 'clone', E2E_REPO, artifactsRepo])

		// Ensure tasks/ directory exists in artifacts repo
		const tasksDir = join(artifactsRepo, 'tasks')
		if (!existsSync(tasksDir)) {
			mkdirSync(tasksDir, { recursive: true })
			writeFileSync(join(tasksDir, '.gitkeep'), '')
			await run('git', ['add', '.'], artifactsRepo)
			await run('git', ['commit', '-m', 'Add tasks directory'], artifactsRepo)
			await run('git', ['push'], artifactsRepo)
		}
	})

	afterAll(() => {
		if (tempRoot && existsSync(tempRoot)) {
			rmSync(tempRoot, { recursive: true, force: true })
		}
	})

	test('init creates config in collections format, sync pushes changes', async () => {
		// Run rpi init (stderr may contain warning about missing config file - that's expected)
		const initResult = await run(
			'bun',
			['run', CLI_PATH, 'init', '--local', artifactsRepo, '--config-file', configFile],
			codeRepo,
		)

		expect(initResult.exitCode).toBe(0)
		expect(initResult.stdout.toString()).toContain('RPI setup complete')

		// Verify config is in collections format
		const config = JSON.parse(readFileSync(configFile, 'utf-8'))
		expect(config.collections).toBeDefined()
		expect(config.collections.default).toBeDefined()
		expect(config.collections.default.artifactsRepo).toBe(artifactsRepo)
		expect(config.defaultCollection).toBe('default')
		// Legacy fields should NOT be present at root
		expect(config.artifactsRepo).toBeUndefined()

		// Verify rpi/tasks symlink was created
		expect(existsSync(join(codeRepo, 'rpi', 'tasks'))).toBe(true)

		// Create a test file in rpi/tasks/test/
		const testTaskDir = join(codeRepo, 'rpi', 'tasks', 'e2e-test')
		mkdirSync(testTaskDir, { recursive: true })
		const testFile = join(testTaskDir, 'test-file.md')
		const testContent = `# E2E Test\n\nCreated at ${new Date().toISOString()}`
		writeFileSync(testFile, testContent)

		// Run rpi sync
		const syncResult = await run(
			'bun',
			['run', CLI_PATH, 'sync', '-m', 'E2E test sync', '--config-file', configFile],
			codeRepo,
		)

		expect(syncResult.exitCode).toBe(0)
		const syncOutput = syncResult.stdout.toString()
		expect(syncOutput).toMatch(/synchronized|Pushed to remote/)

		// Verify file exists in artifacts repo (via symlink, it's the same location)
		expect(existsSync(join(artifactsRepo, 'tasks', 'e2e-test', 'test-file.md'))).toBe(true)

		// Verify it was actually pushed by checking git log
		const logResult = await run('git', ['log', '-1', '--oneline'], artifactsRepo)
		expect(logResult.stdout.toString()).toContain('E2E test sync')
	})
})
