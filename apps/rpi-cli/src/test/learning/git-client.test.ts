// @ts-nocheck - git-client types are incomplete, but the runtime API works as demonstrated
/**
 * Learning tests for git-client npm package
 *
 * Purpose: Demonstrate how git-client can replace execSync-based git operations
 * in the sync and permalink implementations.
 *
 * Current execSync operations to replace (from sync.ts and permalink.ts):
 * - git add -A                              (sync.ts:111)
 * - git status --porcelain                  (sync.ts:21)
 * - git commit -m "message"                 (sync.ts:120)
 * - git remote get-url origin               (sync.ts:34,129 & permalink.ts:13)
 * - git rev-parse --abbrev-ref @{upstream}  (sync.ts:139)
 * - git pull --rebase                       (sync.ts:147)
 * - git push -u origin main                 (sync.ts:167)
 * - git branch --show-current               (get current branch name)
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import git from 'git-client'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

/**
 * Helper to create git options that properly isolate to a specific repo.
 * Uses both $gitDir and $workTree to fully isolate from parent repos.
 */
function gitOpts(repoPath: string) {
	return {
		$gitDir: join(repoPath, '.git'),
		$workTree: repoPath,
	}
}

describe('git-client learning tests', () => {
	let tempDir: string

	beforeAll(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'git-client-test-'))
	})

	afterAll(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	describe('basic operations in a fresh repo', () => {
		let repoDir: string

		beforeAll(async () => {
			repoDir = join(tempDir, 'basic-repo')
			mkdirSync(repoDir, { recursive: true })
			// Initialize a fresh git repo
			await git('init', { ...gitOpts(repoDir) })
			await git('config', { ...gitOpts(repoDir) }, 'user.email', 'test@example.com')
			await git('config', { ...gitOpts(repoDir) }, 'user.name', 'Test User')
		})

		/**
		 * Replaces: execSync('git status --porcelain', { cwd: repoPath })
		 * Used in: sync.ts:21 (checkGitStatus function)
		 */
		test('git status --porcelain - check for uncommitted changes', async () => {
			// Create a file to have something to show in status
			writeFileSync(join(repoDir, 'test.txt'), 'hello')

			// git-client equivalent of: git status --porcelain
			const status = await git.status({ porcelain: true, ...gitOpts(repoDir) })

			expect(status).toContain('?? test.txt')
			console.log('STATUS OUTPUT:', status)
		})

		/**
		 * Replaces: execSync('git add -A', { cwd: expandedRepo })
		 * Used in: sync.ts:111
		 */
		test('git add -A - stage all changes', async () => {
			// git-client equivalent of: git add -A
			await git.add({ A: true, ...gitOpts(repoDir) })

			// Verify file is staged
			const status = await git.status({ porcelain: true, ...gitOpts(repoDir) })
			expect(status).toContain('A  test.txt')
			console.log('AFTER ADD STATUS:', status)
		})

		/**
		 * Replaces: execFileSync('git', ['commit', '-m', commitMessage], { cwd: expandedRepo })
		 * Used in: sync.ts:120
		 */
		test('git commit -m "message" - create a commit', async () => {
			// git-client equivalent of: git commit -m "message"
			const result = await git.commit({ m: 'Initial commit', ...gitOpts(repoDir) })

			expect(result).toContain('Initial commit')
			console.log('COMMIT OUTPUT:', result)

			// Verify clean status after commit
			const status = await git.status({ porcelain: true, ...gitOpts(repoDir) })
			expect(status.trim()).toBe('')
		})

		/**
		 * Replaces: git branch --show-current
		 * Alternative: git rev-parse --abbrev-ref HEAD
		 * Used in: determining current branch name
		 */
		test('git branch --show-current - get current branch name', async () => {
			// git-client equivalent of: git branch --show-current
			// Note: branch --show-current may not work in older git, use rev-parse
			const branch = await git('rev-parse', '--abbrev-ref', 'HEAD', { ...gitOpts(repoDir) })

			// In a fresh repo with one commit, we should be on main or master
			expect(['main', 'master']).toContain(branch.trim())
			console.log('CURRENT BRANCH:', branch.trim())
		})
	})

	describe('remote operations', () => {
		let localRepo: string
		let bareRemote: string

		beforeAll(async () => {
			// Create a bare repo to act as "remote"
			bareRemote = join(tempDir, 'remote.git')
			mkdirSync(bareRemote, { recursive: true })
			// Use $cwd to ensure isolation - git init --bare in the target directory
			await git('init', '--bare', { $cwd: bareRemote })

			// Create local repo
			localRepo = join(tempDir, 'local-repo')
			mkdirSync(localRepo, { recursive: true })
			await git('init', { ...gitOpts(localRepo) })
			await git('config', { ...gitOpts(localRepo) }, 'user.email', 'test@example.com')
			await git('config', { ...gitOpts(localRepo) }, 'user.name', 'Test User')

			// Add remote
			await git.remote('add', 'origin', bareRemote, { ...gitOpts(localRepo) })

			// Create initial commit so we have something to push
			writeFileSync(join(localRepo, 'README.md'), '# Test')
			await git.add({ A: true, ...gitOpts(localRepo) })
			await git.commit({ m: 'Initial commit', ...gitOpts(localRepo) })
		})

		/**
		 * Replaces: execSync('git remote get-url origin', { cwd: repoPath })
		 * Used in: sync.ts:34,129 and permalink.ts:13
		 */
		test('git remote get-url origin - get remote URL', async () => {
			// git-client equivalent of: git remote get-url origin
			const remoteUrl = await git.remote('get-url', 'origin', { ...gitOpts(localRepo) })

			expect(remoteUrl.trim()).toBe(bareRemote)
			console.log('REMOTE URL:', remoteUrl.trim())
		})

		/**
		 * Replaces: execSync('git push -u origin main', { cwd: expandedRepo })
		 * Used in: sync.ts:167
		 */
		test('git push -u origin main - push with upstream tracking', async () => {
			// Rename branch to main if it's master (for consistency)
			const currentBranch = (await git('rev-parse', '--abbrev-ref', 'HEAD', { ...gitOpts(localRepo) })).trim()
			if (currentBranch === 'master') {
				await git.branch({ m: true, ...gitOpts(localRepo) }, 'master', 'main')
			}

			// git-client equivalent of: git push -u origin main
			const result = await git.push({ u: true, ...gitOpts(localRepo) }, 'origin', 'main')

			console.log('PUSH OUTPUT:', result)
		})

		/**
		 * Replaces: execSync('git rev-parse --abbrev-ref @{upstream}', { cwd: expandedRepo })
		 * Used in: sync.ts:139 (check if upstream tracking is set)
		 */
		test('git rev-parse --abbrev-ref @{upstream} - check upstream tracking', async () => {
			// After push -u, upstream should be set
			// git-client equivalent of: git rev-parse --abbrev-ref @{upstream}
			const upstream = await git('rev-parse', '--abbrev-ref', '@{upstream}', { ...gitOpts(localRepo) })

			expect(upstream.trim()).toBe('origin/main')
			console.log('UPSTREAM:', upstream.trim())
		})

		/**
		 * Replaces: execSync('git pull --rebase', { cwd: expandedRepo })
		 * Used in: sync.ts:147
		 */
		test('git pull --rebase - pull with rebase', async () => {
			// git-client equivalent of: git pull --rebase
			const result = await git.pull({ rebase: true, ...gitOpts(localRepo) })

			// Should show "Already up to date" or similar since nothing changed
			expect(result).toContain('up to date')
			console.log('PULL OUTPUT:', result)
		})

		/**
		 * Test getRemoteDefaultBranch behavior
		 * Used in: sync.ts, permalink.ts for determining which branch to use in URLs
		 */
		test('getRemoteDefaultBranch - detect remote default branch', async () => {
			// Import the function
			const { getRemoteDefaultBranch } = await import('../../lib/git-utils.js')

			// Test in localRepo which has origin set up
			const defaultBranch = await getRemoteDefaultBranch(localRepo)

			// Should return 'main' or 'master' depending on what exists
			expect(['main', 'master']).toContain(defaultBranch)
			console.log('DETECTED DEFAULT BRANCH:', defaultBranch)
		})

		test('getRemoteDefaultBranch - fallback when no remote', async () => {
			// Create a repo with no remote
			const noRemoteRepo = join(tempDir, 'no-remote-repo')
			mkdirSync(noRemoteRepo, { recursive: true })
			await git('init', { ...gitOpts(noRemoteRepo) })
			await git('config', { ...gitOpts(noRemoteRepo) }, 'user.email', 'test@example.com')
			await git('config', { ...gitOpts(noRemoteRepo) }, 'user.name', 'Test User')

			const { getRemoteDefaultBranch } = await import('../../lib/git-utils.js')

			// Should fallback to 'main' when no remote exists
			const defaultBranch = await getRemoteDefaultBranch(noRemoteRepo)
			expect(defaultBranch).toBe('main')
		})
	})

	describe('error handling patterns', () => {
		let repoDir: string

		beforeAll(async () => {
			repoDir = join(tempDir, 'error-repo')
			mkdirSync(repoDir, { recursive: true })
			await git('init', { ...gitOpts(repoDir) })
			await git('config', { ...gitOpts(repoDir) }, 'user.email', 'test@example.com')
			await git('config', { ...gitOpts(repoDir) }, 'user.name', 'Test User')
		})

		/**
		 * Demonstrates: Using $nullOnError for graceful error handling
		 * Pattern used in: sync.ts where we check if remote exists
		 */
		test('$nullOnError - graceful handling when remote does not exist', async () => {
			// Try to get remote URL when no remote is configured
			// With $nullOnError, returns null instead of throwing
			const result = await git.remote('get-url', 'origin', {
				...gitOpts(repoDir),
				$nullOnError: true,
			})

			expect(result).toBeNull()
			console.log('NO REMOTE RESULT:', result)
		})

		/**
		 * Demonstrates: Using $nullOnError for upstream check
		 * Pattern used in: sync.ts:139 where we check if upstream tracking is set
		 */
		test('$nullOnError - graceful handling when no upstream set', async () => {
			// Try to get upstream when not set
			const result = await git('rev-parse', '--abbrev-ref', '@{upstream}', {
				...gitOpts(repoDir),
				$nullOnError: true,
			})

			expect(result).toBeNull()
			console.log('NO UPSTREAM RESULT:', result)
		})

		/**
		 * Demonstrates: Traditional try/catch pattern (alternative to $nullOnError)
		 */
		test('try/catch pattern - equivalent to current execSync error handling', async () => {
			let hasRemote = false
			try {
				await git.remote('get-url', 'origin', { ...gitOpts(repoDir) })
				hasRemote = true
			} catch {
				hasRemote = false
			}

			expect(hasRemote).toBe(false)
			console.log('HAS REMOTE:', hasRemote)
		})
	})

	describe('status checking patterns', () => {
		let repoDir: string

		beforeAll(async () => {
			repoDir = join(tempDir, 'status-repo')
			mkdirSync(repoDir, { recursive: true })
			await git('init', { ...gitOpts(repoDir) })
			await git('config', { ...gitOpts(repoDir) }, 'user.email', 'test@example.com')
			await git('config', { ...gitOpts(repoDir) }, 'user.name', 'Test User')
		})

		/**
		 * Demonstrates: checkGitStatus pattern using git-client
		 * Replaces: sync.ts:19-30 (checkGitStatus function)
		 */
		test('checkGitStatus pattern - detect uncommitted changes', async () => {
			// Initial state: no changes
			const statusEmpty = await git.status({ porcelain: true, ...gitOpts(repoDir) })
			const hasChangesInitial = statusEmpty.trim().length > 0
			expect(hasChangesInitial).toBe(false)

			// Add a file
			writeFileSync(join(repoDir, 'newfile.txt'), 'content')

			// Now should have changes
			const statusWithChanges = await git.status({ porcelain: true, ...gitOpts(repoDir) })
			const hasChangesAfter = statusWithChanges.trim().length > 0
			expect(hasChangesAfter).toBe(true)

			console.log('EMPTY STATUS:', JSON.stringify(statusEmpty))
			console.log('WITH CHANGES:', statusWithChanges)
		})
	})

	describe('complete sync flow simulation', () => {
		let localRepo: string
		let bareRemote: string

		beforeAll(async () => {
			bareRemote = join(tempDir, 'sync-remote.git')
			mkdirSync(bareRemote, { recursive: true })
			// Use $cwd to ensure isolation - git init --bare in the target directory
			await git('init', '--bare', { $cwd: bareRemote })

			localRepo = join(tempDir, 'sync-local')
			mkdirSync(localRepo, { recursive: true })
			await git('init', { ...gitOpts(localRepo) })
			await git('config', { ...gitOpts(localRepo) }, 'user.email', 'test@example.com')
			await git('config', { ...gitOpts(localRepo) }, 'user.name', 'Test User')
			await git.remote('add', 'origin', bareRemote, { ...gitOpts(localRepo) })

			// Initial commit
			writeFileSync(join(localRepo, 'README.md'), '# Sync Test')
			await git.add({ A: true, ...gitOpts(localRepo) })
			await git.commit({ m: 'Initial', ...gitOpts(localRepo) })

			// Rename to main if needed
			const branch = (await git('rev-parse', '--abbrev-ref', 'HEAD', { ...gitOpts(localRepo) })).trim()
			if (branch === 'master') {
				await git.branch({ m: true, ...gitOpts(localRepo) }, 'master', 'main')
			}

			// Initial push
			await git.push({ u: true, ...gitOpts(localRepo) }, 'origin', 'main')
		})

		/**
		 * Demonstrates: Full sync flow using git-client
		 * Equivalent to: syncThoughts function in sync.ts:107-189
		 */
		test('full sync flow - add, commit, pull --rebase, push', async () => {
			// 1. Create a new file (simulating RPI artifact change)
			mkdirSync(join(localRepo, 'tasks'), { recursive: true })
			writeFileSync(join(localRepo, 'tasks/test-task.md'), '# Test Task')

			// 2. Stage all changes (sync.ts:111)
			await git.add({ A: true, ...gitOpts(localRepo) })

			// 3. Check for changes (sync.ts:116)
			const status = await git.status({ porcelain: true, ...gitOpts(localRepo) })
			const hasChanges = status.trim().length > 0
			expect(hasChanges).toBe(true)

			// 4. Commit if changes exist (sync.ts:120)
			if (hasChanges) {
				const commitMessage = `Sync RPI - ${new Date().toISOString()}`
				await git.commit({ m: commitMessage, ...gitOpts(localRepo) })
			}

			// 5. Check remote exists (sync.ts:129)
			const remoteUrl = await git.remote('get-url', 'origin', {
				...gitOpts(localRepo),
				$nullOnError: true,
			})
			expect(remoteUrl).not.toBeNull()

			// 6. Check upstream tracking (sync.ts:139)
			const upstream = await git('rev-parse', '--abbrev-ref', '@{upstream}', {
				...gitOpts(localRepo),
				$nullOnError: true,
			})
			expect(upstream).not.toBeNull()

			// 7. Pull with rebase (sync.ts:147)
			const pullResult = await git.pull({ rebase: true, ...gitOpts(localRepo) })
			console.log('PULL RESULT:', pullResult)

			// 8. Push (sync.ts:167)
			const pushResult = await git.push({ u: true, ...gitOpts(localRepo) }, 'origin', 'main')
			console.log('PUSH RESULT:', pushResult)

			// Verify clean status
			const finalStatus = await git.status({ porcelain: true, ...gitOpts(localRepo) })
			expect(finalStatus.trim()).toBe('')
		})
	})
})
