import { access, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

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

export interface RecentTask {
	name: string
	path: string
	modifiedAt: Date
}

export async function getRecentTasks(tasksDir: string, days: number): Promise<RecentTask[]> {
	if (!(await exists(tasksDir))) {
		return []
	}

	const realTasksDir = await realpath(tasksDir)

	if (!(await exists(realTasksDir))) {
		return []
	}

	const cutoffDate = new Date()
	cutoffDate.setDate(cutoffDate.getDate() - days)

	const entries = await readdir(realTasksDir, { withFileTypes: true })
	const tasks: RecentTask[] = []

	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) {
			continue
		}

		const taskPath = path.join(realTasksDir, entry.name)
		const stats = await stat(taskPath)

		if (stats.mtime >= cutoffDate) {
			tasks.push({
				name: entry.name,
				path: taskPath,
				modifiedAt: stats.mtime,
			})
		}
	}

	return tasks.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
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

interface TasksOptions {
	days?: string
	configFile?: string
}

export async function tasksCommand(options: TasksOptions): Promise<void> {
	try {
		const config = await loadRpiConfig(options)

		if (!config) {
			console.error(chalk.red('Error: RPI not configured. Run "rpi init" first.'))
			process.exit(1)
		}

		const days = options.days ? Number.parseInt(options.days, 10) : 3

		if (Number.isNaN(days) || days < 1) {
			console.error(chalk.red('Error: --days must be a positive number'))
			process.exit(1)
		}

		const tasksDir = getTasksPath(getResolvedArtifactsRepo(process.cwd(), config))

		const tasks = await getRecentTasks(tasksDir, days)

		console.log(chalk.blue(`Recent Tasks (last ${days} day${days > 1 ? 's' : ''})`))
		console.log(chalk.gray('='.repeat(50)))
		console.log('')

		if (tasks.length === 0) {
			console.log(chalk.gray(`No tasks modified in the last ${days} day${days > 1 ? 's' : ''}`))
		} else {
			for (const task of tasks) {
				console.log(`  ${chalk.cyan(task.name)}`)
				console.log(`    ${chalk.gray(formatRelativeTime(task.modifiedAt))}`)
			}
		}
	} catch (error) {
		const message = Predicate.isError(error) ? error.message : 'Unknown error'
		console.error(chalk.red(`Error listing tasks: ${message}`))
		process.exit(1)
	}
}
