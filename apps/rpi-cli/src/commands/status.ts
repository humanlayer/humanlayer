import { access, lstat, readlink } from 'node:fs/promises'
import path from 'node:path'

import { $ } from 'bun'
import chalk from 'chalk'
import * as Predicate from 'effect/Predicate'

async function exists(p: string): Promise<boolean> {
	try {
		await access(p)
		return true
	} catch {
		return false
	}
}

import { getResolvedArtifactsRepo, getTasksPath, loadRpiConfig } from '../config'
import { getRecentTasks } from './tasks'

async function getGitStatus(repoPath: string): Promise<string> {
	try {
		const result = await $`git status -sb`.cwd(repoPath).quiet().nothrow()
		if (result.exitCode !== 0) return 'Not a git repository'
		return result.stdout.toString().trim()
	} catch {
		return 'Not a git repository'
	}
}

async function getUncommittedChanges(repoPath: string): Promise<string[]> {
	try {
		const result = await $`git status --porcelain`.cwd(repoPath).quiet().nothrow()
		if (result.exitCode !== 0) return []

		const output = result.stdout.toString()
		return output
			.split('\n')
			.filter((line) => line.trim())
			.map((line) => {
				const status = line.substring(0, 2)
				const file = line.substring(3)
				let statusText = ''

				if (status[0] === 'M' || status[1] === 'M') statusText = 'modified'
				else if (status[0] === 'A') statusText = 'added'
				else if (status[0] === 'D') statusText = 'deleted'
				else if (status[0] === '?') statusText = 'untracked'
				else if (status[0] === 'R') statusText = 'renamed'

				return `  ${chalk.yellow(statusText.padEnd(10))} ${file}`
			})
	} catch {
		return []
	}
}

async function getLastCommit(repoPath: string): Promise<string> {
	try {
		const result = await $`git log -1 --pretty=format:%h %s (%cr)`.cwd(repoPath).quiet().nothrow()
		if (result.exitCode !== 0) return 'No commits yet'
		return result.stdout.toString().trim()
	} catch {
		return 'No commits yet'
	}
}

async function getRemoteStatus(repoPath: string): Promise<string> {
	try {
		const remoteCheck = await $`git remote get-url origin`.cwd(repoPath).quiet().nothrow()
		if (remoteCheck.exitCode !== 0) {
			return chalk.gray('No remote configured')
		}

		try {
			await $`git fetch`.cwd(repoPath).quiet().nothrow()
		} catch {
			// Fetch might fail, continue anyway
		}

		const statusResult = await $`git status -sb`.cwd(repoPath).quiet().nothrow()
		if (statusResult.exitCode !== 0) {
			return chalk.gray('No remote configured')
		}
		const status = statusResult.stdout.toString()

		if (status.includes('ahead')) {
			const ahead = status.match(/ahead (\d+)/)?.[1] || '?'
			return chalk.yellow(`${ahead} commits ahead of remote`)
		} else if (status.includes('behind')) {
			const behind = status.match(/behind (\d+)/)?.[1] || '?'

			try {
				const pullResult = await $`git pull --rebase`.cwd(repoPath).quiet().nothrow()
				if (pullResult.exitCode === 0) {
					console.log(chalk.green('✓ Automatically pulled latest changes'))

					const newStatusResult = await $`git status -sb`.cwd(repoPath).quiet()
					const newStatus = newStatusResult.stdout.toString()

					if (newStatus.includes('behind')) {
						const newBehind = newStatus.match(/behind (\d+)/)?.[1] || '?'
						return chalk.yellow(`${newBehind} commits behind remote (after pull)`)
					} else {
						return chalk.green('Up to date with remote (after pull)')
					}
				} else {
					return chalk.yellow(`${behind} commits behind remote`)
				}
			} catch {
				return chalk.yellow(`${behind} commits behind remote`)
			}
		} else {
			return chalk.green('Up to date with remote')
		}
	} catch {
		return chalk.gray('No remote configured')
	}
}

function formatRelativeTime(date: Date): string {
	const now = new Date()
	const diffMs = now.getTime() - date.getTime()
	const diffMins = Math.floor(diffMs / (1000 * 60))
	const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

	if (diffMins < 1) return 'just now'
	if (diffMins < 60) return `${diffMins} min ago`
	if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
	return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
}

interface StatusOptions {
	configFile?: string
	[key: string]: string | undefined
}

export async function statusCommand(options: StatusOptions): Promise<void> {
	try {
		const config = await loadRpiConfig(options)

		if (!config) {
			console.error(chalk.red('Error: RPI not configured. Run "rpi init" first.'))
			process.exit(1)
		}

		// Get the resolved artifacts repo for the current directory
		const expandedRepo = getResolvedArtifactsRepo(process.cwd(), config)

		console.log(chalk.blue('Artifacts Repository Status'))
		console.log(chalk.gray('='.repeat(50)))
		console.log('')

		// Show configuration (simplified)
		console.log(chalk.yellow('Configuration:'))
		console.log(`  Artifacts Repository: ${chalk.cyan(expandedRepo)}`)
		console.log(`  Tasks: ${chalk.cyan(`${expandedRepo}/tasks`)}`)
		console.log('')

		// Check current repo symlink status
		const currentRepo = process.cwd()
		const rpiDir = path.join(currentRepo, 'rpi')
		const tasksSymlink = path.join(rpiDir, 'tasks')

		console.log(chalk.yellow('Current Repository:'))
		console.log(`  Path: ${chalk.cyan(currentRepo)}`)

		if (await exists(tasksSymlink)) {
			const stats = await lstat(tasksSymlink)
			if (stats.isSymbolicLink()) {
				const target = await readlink(tasksSymlink)
				console.log(`  Symlink: ${chalk.green('✓ Initialized')} → ${target}`)
			} else if (await exists(rpiDir)) {
				console.log(`  Status: ${chalk.yellow('⚠ rpi/ exists but not properly configured')}`)
			}
		} else if (await exists(rpiDir)) {
			console.log(`  Status: ${chalk.yellow('⚠ rpi/ exists but not properly configured')}`)
		} else {
			console.log(`  Status: ${chalk.gray('Not initialized')}`)
		}
		console.log('')

		// Show recent tasks
		const tasksDir = getTasksPath(expandedRepo)
		if (await exists(tasksDir)) {
			const recentTasks = await getRecentTasks(tasksDir, 3)

			console.log(chalk.yellow('Recent Tasks (last 3 days):'))
			if (recentTasks.length === 0) {
				console.log(chalk.gray('  No tasks modified in the last 3 days'))
			} else {
				for (const task of recentTasks) {
					console.log(`  ${chalk.cyan(task.name)} ${chalk.gray(`(${formatRelativeTime(task.modifiedAt)})`)}`)
				}
			}
			console.log(chalk.gray('  Run "rpi tasks --days N" to see more'))
			console.log('')
		}

		// Show artifacts repository git status

		console.log(chalk.yellow('Artifacts Repository Git Status:'))
		console.log(`  ${await getGitStatus(expandedRepo)}`)
		console.log(`  Remote: ${await getRemoteStatus(expandedRepo)}`)
		console.log(`  Last commit: ${await getLastCommit(expandedRepo)}`)
		console.log('')

		// Show uncommitted changes
		const changes = await getUncommittedChanges(expandedRepo)
		if (changes.length > 0) {
			console.log(chalk.yellow('Uncommitted changes:'))
			changes.forEach((change) => {
				console.log(change)
			})
			console.log('')
			console.log(chalk.gray('Run "rpi sync" to commit these changes'))
		} else {
			console.log(chalk.green('✓ No uncommitted changes'))
		}
	} catch (error) {
		const message = Predicate.isError(error) ? error.message : 'Unknown error'
		console.error(chalk.red(`Error checking RPI status: ${message}`))
		process.exit(1)
	}
}
