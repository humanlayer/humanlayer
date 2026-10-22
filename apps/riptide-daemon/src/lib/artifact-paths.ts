import { appendFile, lstat, mkdir, readdir, readlink, rename, rm, symlink, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { checkArtifactsGitignored } from '@/effects/check-artifacts-gitignored'
import type { DaemonRuntime } from '@/effects/runtime'
import { logger } from '@/logger'

/**
 * Get the UUID-based artifact storage path.
 * ~/.humanlayer/riptide/artifacts/{taskId}/
 */
export function getArtifactStoragePath(taskId: string): string {
	return join(homedir(), '.humanlayer', 'riptide', 'artifacts', taskId)
}

/**
 * Get the in-repo symlink path for artifacts.
 * {cwd}/.humanlayer/tasks/{taskSlug}/
 */
export function getArtifactSymlinkPath(cwd: string, taskSlug: string): string {
	return join(cwd, '.humanlayer', 'tasks', taskSlug)
}

/**
 * Ensure the symlink from in-repo path to UUID storage.
 * Creates storage directory, parent directories, and symlink if needed.
 * If symlink exists but points elsewhere, updates it.
 */
export async function ensureArtifactSymlink(
	cwd: string,
	taskId: string,
	taskSlug: string,
): Promise<{ storagePath: string; symlinkPath: string }> {
	const storagePath = getArtifactStoragePath(taskId)
	const symlinkPath = getArtifactSymlinkPath(cwd, taskSlug)

	// Ensure storage exists
	await mkdir(storagePath, { recursive: true })

	// Ensure parent directory exists
	await mkdir(dirname(symlinkPath), { recursive: true })

	// Check what exists at the symlink path
	try {
		const stats = await lstat(symlinkPath)
		if (stats.isSymbolicLink()) {
			// Symlink exists — check if it points to the correct storage
			const existingTarget = await readlink(symlinkPath)
			if (existingTarget === storagePath) {
				logger.debug({ taskId, taskSlug, symlinkPath }, 'Symlink already exists and is correct')
				return { storagePath, symlinkPath }
			}
			// Symlink points elsewhere — remove and recreate
			logger.info({ taskId, taskSlug, existingTarget, storagePath }, 'Updating symlink target')
			await unlink(symlinkPath)
		} else if (stats.isDirectory()) {
			// Plain directory exists (created by tauri before this fix) — migrate contents to UUID storage
			logger.info({ taskId, taskSlug, symlinkPath, storagePath }, 'Migrating plain directory to symlink')
			const files = await readdir(symlinkPath)
			for (const file of files) {
				await rename(join(symlinkPath, file), join(storagePath, file))
			}
			await rm(symlinkPath, { recursive: true })
		} else {
			// Something else (regular file) — remove it
			logger.warn({ taskId, taskSlug, symlinkPath }, 'Unexpected file at symlink path, removing')
			await unlink(symlinkPath)
		}
	} catch (error) {
		// Path doesn't exist — that's fine, fall through to create
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error
		}
	}

	// Create symlink
	try {
		await symlink(storagePath, symlinkPath)
		logger.info({ taskId, taskSlug, symlinkPath, storagePath }, 'Created artifact symlink')
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			// Another concurrent caller created the symlink — verify it's correct
			const existingTarget = await readlink(symlinkPath)
			if (existingTarget === storagePath) {
				logger.debug({ taskId, taskSlug }, 'Symlink created by concurrent caller, target is correct')
			} else {
				throw new Error(`Concurrent symlink creation conflict: expected ${storagePath}, got ${existingTarget}`)
			}
		} else {
			throw error
		}
	}
	return { storagePath, symlinkPath }
}

/**
 * Check whether a directory is a git repository (or worktree).
 * Worktrees have a `.git` *file* pointing at the parent repo, so any `.git`
 * entry counts. A multi-repo workspace root has no `.git` at all.
 */
export async function isGitRepository(cwd: string): Promise<boolean> {
	try {
		await lstat(join(cwd, '.git'))
		return true
	} catch {
		return false
	}
}

/**
 * Append .humanlayer/tasks/ to the project's .gitignore.
 * Callers must first confirm that Git has no effective matching rule.
 */
export async function ensureGitignore(cwd: string): Promise<void> {
	const gitignorePath = join(cwd, '.gitignore')
	const entry = '.humanlayer/tasks/'

	await appendFile(gitignorePath, `\n# Riptide artifacts (cloud-synced)\n${entry}\n`)
	logger.info({ cwd }, 'Added .humanlayer/tasks/ to .gitignore')
}

/**
 * Set up artifact directory structure for a task.
 * 1. Ensure symlink from {cwd}/.humanlayer/tasks/{slug}/ → UUID storage (also creates storage)
 * 2. Ensure .humanlayer/tasks/ is in .gitignore — skipped when the cwd is not a
 *    git repo (e.g. a multi-repo workspace root), so no stray .gitignore is written there.
 *
 * The symlink (step 1) is required for artifacts to sync, so its failures
 * propagate. The .gitignore step (step 2) is best-effort convenience — a write
 * failure there is logged but not thrown, so it can't abort artifact setup.
 */
export async function setupArtifactPaths(
	cwd: string,
	taskId: string,
	taskSlug: string,
	daemonRuntime: DaemonRuntime,
): Promise<{ storagePath: string; symlinkPath: string }> {
	const { storagePath, symlinkPath } = await ensureArtifactSymlink(cwd, taskId, taskSlug)

	try {
		if (await isGitRepository(cwd)) {
			const ignoreStatus = await daemonRuntime.runPromise(checkArtifactsGitignored({ cwd }))
			if (ignoreStatus === 'not-ignored') await ensureGitignore(cwd)
		} else {
			logger.debug({ cwd }, 'Skipping .gitignore setup: cwd is not a git repository (workspace root launch)')
		}
	} catch (error) {
		logger.warn({ cwd, error }, 'Failed to ensure .gitignore for artifacts; continuing without it')
	}

	return { storagePath, symlinkPath }
}
