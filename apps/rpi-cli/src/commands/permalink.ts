import { access } from 'node:fs/promises'
import path from 'node:path'

import { $ } from 'bun'
import chalk from 'chalk'
import * as Predicate from 'effect/Predicate'

import { getResolvedArtifactsRepo, getTasksPath, loadRpiConfig } from '../config'

async function exists(p: string): Promise<boolean> {
	try {
		await access(p)
		return true
	} catch {
		return false
	}
}

import { getRemoteDefaultBranch } from '../lib/git-utils'

interface PermalinkOptions {
	configFile?: string
}

async function getGitRemoteUrl(repoPath: string): Promise<string | null> {
	try {
		const result = await $`git remote get-url origin`.cwd(repoPath).quiet().nothrow()
		if (result.exitCode !== 0) return null

		const remoteUrl = result.stdout.toString().trim()

		// Convert SSH URLs to HTTPS
		if (remoteUrl.startsWith('git@github.com:')) {
			return remoteUrl.replace('git@github.com:', 'https://github.com/').replace(/\.git$/, '')
		}
		if (remoteUrl.startsWith('https://github.com/')) {
			return remoteUrl.replace(/\.git$/, '')
		}

		return remoteUrl
	} catch {
		return null
	}
}

export async function permalinkCommand(rpiPath: string, options: PermalinkOptions): Promise<void> {
	try {
		const config = await loadRpiConfig(options)

		if (!config) {
			console.error(chalk.red('Error: RPI not configured. Run "rpi init" first.'))
			process.exit(1)
		}

		// Parse the rpi path (e.g., "rpi/tasks/test" or "tasks/test")
		const normalizedPath = rpiPath.startsWith('rpi/') ? rpiPath.substring(4) : rpiPath

		// Get the resolved artifacts repo for the current directory
		const expandedRepo = getResolvedArtifactsRepo(process.cwd(), config)

		// Build the actual file path
		const tasksPath = getTasksPath(expandedRepo)
		// normalizedPath should start with "tasks/", strip it
		const pathWithoutTasks = normalizedPath.startsWith('tasks/') ? normalizedPath.substring(6) : normalizedPath
		const fullPath = path.join(tasksPath, pathWithoutTasks)

		// Check if path exists
		if (!(await exists(fullPath))) {
			console.error(chalk.red(`Error: Path does not exist: ${fullPath}`))
			process.exit(1)
		}

		// Get git info
		const remoteUrl = await getGitRemoteUrl(expandedRepo)
		if (!remoteUrl) {
			console.error(chalk.red('Error: Could not determine git remote URL'))
			console.error(chalk.yellow('Make sure your artifacts repository has a remote configured'))
			process.exit(1)
		}

		// Detect the correct branch for permalinks
		const branch = await getRemoteDefaultBranch(expandedRepo)

		// Build the GitHub URL - now just tasks/{path}
		const relativePath = `tasks/${pathWithoutTasks}`
		const permalink = `${remoteUrl}/blob/${branch}/${relativePath}`

		console.log(permalink)
	} catch (error) {
		const message = Predicate.isError(error) ? error.message : 'Unknown error'
		console.error(chalk.red(`Error generating permalink: ${message}`))
		process.exit(1)
	}
}
