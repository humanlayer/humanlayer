import { access, rm } from 'node:fs/promises'
import path from 'node:path'

import chalk from 'chalk'
import * as Predicate from 'effect/Predicate'

import { getResolvedArtifactsRepo, loadRpiConfig } from '../config'

async function exists(p: string): Promise<boolean> {
	try {
		await access(p)
		return true
	} catch {
		return false
	}
}

interface UninitOptions {
	force?: boolean
	configFile?: string
}

export async function uninitCommand(options: UninitOptions): Promise<void> {
	try {
		const currentRepo = process.cwd()
		const rpiDir = path.join(currentRepo, 'rpi')

		if (!(await exists(rpiDir))) {
			console.error(chalk.red('Error: RPI not initialized for this repository.'))
			process.exit(1)
		}

		const config = await loadRpiConfig(options)
		if (!config && !options.force) {
			console.error(chalk.red('Error: RPI configuration not found.'))
			console.error(chalk.yellow('Use --force to remove the rpi directory anyway.'))
			process.exit(1)
		}

		console.log(chalk.blue('Removing RPI setup from current repository...'))

		// Remove the entire rpi directory (only symlinks, actual data is safe)
		console.log(chalk.gray('Removing rpi directory (symlinks only)...'))
		try {
			await rm(rpiDir, { recursive: true, force: true })
		} catch (error) {
			const message = Predicate.isError(error) ? error.message : 'Unknown error'
			console.error(chalk.red(`Error removing rpi directory: ${message}`))
			console.error(chalk.yellow(`You may need to manually remove: ${rpiDir}`))
			process.exit(1)
		}

		console.log(chalk.green('✅ RPI removed from repository'))
		console.log('')
		console.log(chalk.gray('Note: Your RPI content remains safe in:'))
		const artifactsPath = config ? getResolvedArtifactsRepo(currentRepo, config) : '~/rpi-artifacts'
		console.log(chalk.gray(`  ${artifactsPath}/tasks/`))
		console.log(chalk.gray('Only the local symlinks were removed.'))
	} catch (error) {
		const message = Predicate.isError(error) ? error.message : 'Unknown error'
		console.error(chalk.red(`Error during rpi uninit: ${message}`))
		process.exit(1)
	}
}
