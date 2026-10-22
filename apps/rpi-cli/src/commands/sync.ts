import { access } from 'node:fs/promises'
import path from 'node:path'

import chalk from 'chalk'
import * as Predicate from 'effect/Predicate'

import { getResolvedArtifactsRepo, loadRpiConfig } from '../config'
import { syncArtifacts } from '../lib/sync'

interface SyncOptions {
	message?: string
	configFile?: string
}

async function syncThoughts(expandedRepo: string, message: string): Promise<void> {
	const result = await syncArtifacts(expandedRepo, { message }, (msg) => {
		console.log(chalk.dim(msg))
	})

	if (result.conflictDetected) {
		console.error(chalk.red('Error: Merge conflict detected'))
		console.error(chalk.red('Please resolve conflicts manually in:'), expandedRepo)
		process.exit(1)
	}
	if (!result.success && result.error) {
		console.error(chalk.red(`Error syncing artifacts: ${result.error}`))
		process.exit(1)
	}
	if (result.committed) {
		console.log(chalk.green('RPI synchronized'))
	} else {
		console.log(chalk.gray('No changes to commit'))
	}
	if (result.pushed) {
		console.log(chalk.green('Pushed to remote'))
	}
}

export async function syncCommand(options: SyncOptions): Promise<void> {
	try {
		const config = await loadRpiConfig(options)

		if (!config) {
			console.error(chalk.red('Error: RPI not configured. Run "rpi init" first.'))
			process.exit(1)
		}

		const currentRepo = process.cwd()
		const thoughtsDir = path.join(currentRepo, 'rpi')

		// Use Node's fs.access instead of Bun's file().exists() for compiled binary compatibility
		try {
			await access(thoughtsDir)
		} catch {
			console.error(chalk.red('Error: RPI not initialized for this repository.'))
			process.exit(1)
		}

		console.log(chalk.blue('Syncing artifacts...'))
		const expandedRepo = getResolvedArtifactsRepo(currentRepo, config)
		await syncThoughts(expandedRepo, options.message || '')
	} catch (error) {
		const message = Predicate.isError(error) ? error.message : 'Unknown error'
		console.error(chalk.red(`Error during RPI sync: ${message}`))
		process.exit(1)
	}
}
