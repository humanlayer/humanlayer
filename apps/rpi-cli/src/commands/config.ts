import { spawn } from 'node:child_process'

import chalk from 'chalk'
import * as Predicate from 'effect/Predicate'

import { getActiveCollectionName, getDefaultConfigPath, loadRpiConfig, migrateConfig } from '../config'

interface ConfigOptions {
	edit?: boolean
	json?: boolean
	configFile?: string
	get?: string
}

export async function configCommand(options: ConfigOptions): Promise<void> {
	try {
		const configPath = options.configFile || getDefaultConfigPath()

		// Handle get mode for specific config values
		if (options.get) {
			const config = await loadRpiConfig(options)
			if (!config) {
				console.error(chalk.red('No RPI configuration found.'))
				console.error('Run "rpi init" to create one.')
				process.exit(1)
			}

			const key = options.get
			if (key in config) {
				const value = config[key as keyof typeof config]
				console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : value)
				return
			}
			console.error(chalk.red(`Config key "${key}" not found`))
			process.exit(1)
		}

		// Handle edit mode
		if (options.edit) {
			const editor = process.env.EDITOR || 'vi'
			spawn(editor, [configPath], { stdio: 'inherit' })
			return
		}

		// Load configuration
		const config = await loadRpiConfig(options)

		if (!config) {
			console.error(chalk.red('No RPI configuration found.'))
			console.error('Run "rpi init" to create one.')
			process.exit(1)
		}

		// Handle JSON output
		if (options.json) {
			console.log(JSON.stringify(config, null, 2))
			return
		}

		const migratedConfig = migrateConfig(config)
		const pwd = process.cwd()
		let activeCollectionName: string | null = null

		try {
			activeCollectionName = getActiveCollectionName(pwd, migratedConfig)
		} catch {
			// No collections configured
		}

		console.log(chalk.bold('\n📁 RPI Configuration\n'))

		// Show worktree_base_path if set
		if (migratedConfig.worktree_base_path) {
			console.log(chalk.cyan('Worktree Base Path:'), migratedConfig.worktree_base_path)
			console.log()
		}

		// Show collections
		console.log(chalk.bold('Collections:'))
		const collections = migratedConfig.collections ?? {}
		if (Object.keys(collections).length === 0) {
			console.log(chalk.gray('  (none configured)'))
		} else {
			for (const [name, collection] of Object.entries(collections)) {
				const isActive = name === activeCollectionName
				const prefix = isActive ? chalk.green('▶ ') : '  '
				const nameDisplay = isActive ? chalk.green.bold(name) : chalk.white(name)
				const linearStatus =
					collection.linearIntegrationEnabled === false ? chalk.yellow(' (Linear disabled)') : ''
				console.log(`${prefix}${nameDisplay}: ${chalk.gray(collection.artifactsRepo)}${linearStatus}`)
			}
		}

		// Show default collection
		if (migratedConfig.defaultCollection) {
			console.log(chalk.cyan('\nDefault Collection:'), migratedConfig.defaultCollection)
		}

		// Show activations
		console.log(chalk.bold('\nActivations:'))
		const activations = migratedConfig.activations ?? []
		if (activations.length === 0) {
			console.log(chalk.gray('  (none configured)'))
		} else {
			for (const activation of activations) {
				console.log(`  ${chalk.gray(activation.match)} → ${chalk.white(activation.collection)}`)
			}
		}

		// Show active collection for current directory
		console.log(chalk.bold('\nCurrent Directory:'))
		console.log(`  ${chalk.gray(pwd)}`)
		if (activeCollectionName) {
			console.log(`  ${chalk.green('Active collection:')} ${activeCollectionName}`)
		} else {
			console.log(chalk.yellow('  No collection resolved'))
		}
		console.log()
	} catch (error) {
		const message = Predicate.isError(error) ? error.message : 'Unknown error'
		console.error(chalk.red(`Error showing RPI config: ${message}`))
		process.exit(1)
	}
}
