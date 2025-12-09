import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import * as p from '@clack/prompts'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { transformCommandFile, transformAgentFile, transformSettings, generateAgentsMd } from './transform.js'

// Get the directory of this module
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface InitOptions {
	force?: boolean
	all?: boolean
}

function ensureGitignoreEntry(targetDir: string, entry: string): void {
	const gitignorePath = path.join(targetDir, '.gitignore')

	// Read existing .gitignore or create empty
	let gitignoreContent = ''
	if (fs.existsSync(gitignorePath)) {
		gitignoreContent = fs.readFileSync(gitignorePath, 'utf8')
	}

	// Check if entry already exists
	const lines = gitignoreContent.split('\n')
	if (lines.some((line) => line.trim() === entry)) {
		return // Already exists
	}

	// Add entry with section comment
	const newContent =
		gitignoreContent +
		(gitignoreContent && !gitignoreContent.endsWith('\n') ? '\n' : '') +
		'\n# OpenCode local settings\n' +
		entry +
		'\n'

	fs.writeFileSync(gitignorePath, newContent)
}

export async function opencodeInitCommand(options: InitOptions): Promise<void> {
	try {
		p.intro(chalk.blue('Initialize OpenCode Configuration'))

		// Check if running in interactive terminal
		if (!process.stdin.isTTY && !options.all) {
			p.log.error('Not running in interactive terminal.')
			p.log.info('Use --all flag to copy all files without prompting.')
			process.exit(1)
		}

		const targetDir = process.cwd()
		const opencodeTargetDir = path.join(targetDir, '.opencode')

		// Determine source location
		// Try multiple possible locations for the .claude directory
		const possiblePaths = [
			// When installed via npm: package root is one level up from dist
			path.resolve(__dirname, '..', '..', '.claude'),
			// When running from repo: repo root is two levels up from dist
			path.resolve(__dirname, '..', '..', '..', '.claude'),
		]

		let sourceClaudeDir: string | null = null
		for (const candidatePath of possiblePaths) {
			if (fs.existsSync(candidatePath)) {
				sourceClaudeDir = candidatePath
				break
			}
		}

		// Verify source directory exists
		if (!sourceClaudeDir) {
			p.log.error('Source .claude directory not found in expected locations')
			p.log.info('Searched paths:')
			possiblePaths.forEach((candidatePath) => {
				p.log.info(`  - ${candidatePath}`)
			})
			p.log.info('Are you running from the humanlayer repository or npm package?')
			process.exit(1)
		}

		// Check if .opencode already exists
		if (fs.existsSync(opencodeTargetDir) && !options.force) {
			const overwrite = await p.confirm({
				message: '.opencode directory already exists. Overwrite?',
				initialValue: false,
			})

			if (p.isCancel(overwrite) || !overwrite) {
				p.cancel('Operation cancelled.')
				process.exit(0)
			}
		}

		let selectedCategories: string[]

		if (options.all) {
			selectedCategories = ['commands', 'agents', 'config', 'scripts', 'agentsmd']
		} else {
			// Interactive selection
			const selection = await p.multiselect({
				message: 'What would you like to copy?',
				options: [
					{
						value: 'commands',
						label: 'Commands',
						hint: '27 workflow commands (planning, CI, research, etc.)',
					},
					{
						value: 'agents',
						label: 'Agents',
						hint: '6 specialized sub-agents for code analysis',
					},
					{
						value: 'config',
						label: 'Config',
						hint: 'Project opencode.json configuration',
					},
					{
						value: 'scripts',
						label: 'Scripts',
						hint: 'Required hack scripts (spec_metadata.sh, create_worktree.sh)',
					},
					{
						value: 'agentsmd',
						label: 'AGENTS.md',
						hint: 'Generate AGENTS.md with project context',
					},
				],
				initialValues: ['commands', 'agents', 'config', 'scripts', 'agentsmd'],
				required: false,
			})

			if (p.isCancel(selection)) {
				p.cancel('Operation cancelled.')
				process.exit(0)
			}

			selectedCategories = selection as string[]

			if (selectedCategories.length === 0) {
				p.cancel('No items selected.')
				process.exit(0)
			}
		}

		// Create .opencode directory
		fs.mkdirSync(opencodeTargetDir, { recursive: true })

		let filesCopied = 0
		let filesSkipped = 0

		// Wizard-style file selection for each category
		const filesToCopyByCategory: Record<string, string[]> = {}

		// If in interactive mode, prompt for file selection per category
		if (!options.all) {
			// Commands file selection (if selected)
			if (selectedCategories.includes('commands')) {
				const sourceDir = path.join(sourceClaudeDir, 'commands')
				if (fs.existsSync(sourceDir)) {
					const allFiles = fs.readdirSync(sourceDir)
					const fileSelection = await p.multiselect({
						message: 'Select command files to copy:',
						options: allFiles.map((file) => ({
							value: file,
							label: file,
						})),
						initialValues: allFiles,
						required: false,
					})

					if (p.isCancel(fileSelection)) {
						p.cancel('Operation cancelled.')
						process.exit(0)
					}

					filesToCopyByCategory['commands'] = fileSelection as string[]

					if (filesToCopyByCategory['commands'].length === 0) {
						filesSkipped += allFiles.length
					}
				}
			}

			// Agents file selection (if selected)
			if (selectedCategories.includes('agents')) {
				const sourceDir = path.join(sourceClaudeDir, 'agents')
				if (fs.existsSync(sourceDir)) {
					const allFiles = fs.readdirSync(sourceDir)
					const fileSelection = await p.multiselect({
						message: 'Select agent files to copy:',
						options: allFiles.map((file) => ({
							value: file,
							label: file,
						})),
						initialValues: allFiles,
						required: false,
					})

					if (p.isCancel(fileSelection)) {
						p.cancel('Operation cancelled.')
						process.exit(0)
					}

					filesToCopyByCategory['agents'] = fileSelection as string[]

					if (filesToCopyByCategory['agents'].length === 0) {
						filesSkipped += allFiles.length
					}
				}
			}
		}

		// Copy selected categories
		for (const category of selectedCategories) {
			if (category === 'commands') {
				const sourceDir = path.join(sourceClaudeDir, 'commands')
				const targetCategoryDir = path.join(opencodeTargetDir, 'command') // SINGULAR

				if (!fs.existsSync(sourceDir)) {
					p.log.warn(`commands directory not found in source, skipping`)
					continue
				}

				// Get all files in category
				const allFiles = fs.readdirSync(sourceDir)

				// Determine which files to copy
				let filesToCopy = allFiles
				if (!options.all && filesToCopyByCategory['commands']) {
					filesToCopy = filesToCopyByCategory['commands']
				}

				if (filesToCopy.length === 0) {
					continue
				}

				// Copy and transform files
				fs.mkdirSync(targetCategoryDir, { recursive: true })

				for (const file of filesToCopy) {
					const sourcePath = path.join(sourceDir, file)
					const targetPath = path.join(targetCategoryDir, file)

					const sourceContent = fs.readFileSync(sourcePath, 'utf8')
					const transformedContent = transformCommandFile(sourceContent)
					fs.writeFileSync(targetPath, transformedContent)
					filesCopied++
				}

				filesSkipped += allFiles.length - filesToCopy.length
				p.log.success(`Copied ${filesToCopy.length} command file(s)`)
			} else if (category === 'agents') {
				const sourceDir = path.join(sourceClaudeDir, 'agents')
				const targetCategoryDir = path.join(opencodeTargetDir, 'agent') // SINGULAR

				if (!fs.existsSync(sourceDir)) {
					p.log.warn(`agents directory not found in source, skipping`)
					continue
				}

				// Get all files in category
				const allFiles = fs.readdirSync(sourceDir)

				// Determine which files to copy
				let filesToCopy = allFiles
				if (!options.all && filesToCopyByCategory['agents']) {
					filesToCopy = filesToCopyByCategory['agents']
				}

				if (filesToCopy.length === 0) {
					continue
				}

				// Copy and transform files
				fs.mkdirSync(targetCategoryDir, { recursive: true })

				for (const file of filesToCopy) {
					const sourcePath = path.join(sourceDir, file)
					const targetPath = path.join(targetCategoryDir, file)

					const sourceContent = fs.readFileSync(sourcePath, 'utf8')
					const transformedContent = transformAgentFile(sourceContent)
					fs.writeFileSync(targetPath, transformedContent)
					filesCopied++
				}

				filesSkipped += allFiles.length - filesToCopy.length
				p.log.success(`Copied ${filesToCopy.length} agent file(s)`)
			} else if (category === 'scripts') {
				// Copy required hack scripts to target repo's hack directory
				const requiredScripts = ['spec_metadata.sh', 'create_worktree.sh']
				const sourceHackDir = path.resolve(sourceClaudeDir, '..', 'hack')
				const targetHackDir = path.join(targetDir, 'hack')

				if (!fs.existsSync(sourceHackDir)) {
					p.log.warn('hack directory not found in source, skipping scripts')
					continue
				}

				// Create hack directory in target
				fs.mkdirSync(targetHackDir, { recursive: true })

				let scriptsCopied = 0
				for (const script of requiredScripts) {
					const sourcePath = path.join(sourceHackDir, script)
					const targetPath = path.join(targetHackDir, script)

					if (!fs.existsSync(sourcePath)) {
						p.log.warn(`Script ${script} not found in source, skipping`)
						continue
					}

					fs.copyFileSync(sourcePath, targetPath)
					// Make script executable (chmod +x)
					fs.chmodSync(targetPath, 0o755)
					scriptsCopied++
				}

				if (scriptsCopied > 0) {
					filesCopied += scriptsCopied
					p.log.success(`Copied ${scriptsCopied} hack script(s)`)
				}
			} else if (category === 'config') {
				const settingsPath = path.join(sourceClaudeDir, 'settings.json')
				const targetConfigPath = path.join(opencodeTargetDir, 'opencode.json')

				if (fs.existsSync(settingsPath)) {
					// Read source settings
					const settingsContent = fs.readFileSync(settingsPath, 'utf8')
					const settings = JSON.parse(settingsContent)

					// Transform settings to OpenCode config
					const opencodeConfig = transformSettings(settings)

					// Write transformed config
					fs.writeFileSync(targetConfigPath, JSON.stringify(opencodeConfig, null, 2) + '\n')
					filesCopied++
					p.log.success(`Generated opencode.json`)
				} else {
					p.log.warn('settings.json not found in source, skipping')
				}
			} else if (category === 'agentsmd') {
				const agentsMd = generateAgentsMd(targetDir)
				fs.writeFileSync(path.join(targetDir, 'AGENTS.md'), agentsMd)
				filesCopied++
				p.log.success('Generated AGENTS.md template (customize as needed)')
			}
		}

		// Update .gitignore to exclude .opencode directory
		if (selectedCategories.length > 0) {
			ensureGitignoreEntry(targetDir, '.opencode/')
			p.log.info('Updated .gitignore to exclude .opencode/')
		}

		// Update .gitignore to exclude hack scripts
		if (selectedCategories.includes('scripts')) {
			ensureGitignoreEntry(targetDir, 'hack/spec_metadata.sh')
			ensureGitignoreEntry(targetDir, 'hack/create_worktree.sh')
			p.log.info('Updated .gitignore to exclude hack scripts')
		}

		let message = `Successfully copied ${filesCopied} file(s) to ${opencodeTargetDir}`
		if (filesSkipped > 0) {
			message += chalk.gray(`\n   Skipped ${filesSkipped} file(s)`)
		}
		message += chalk.gray('\n   You can now use these commands in OpenCode.')

		p.outro(message)
	} catch (error) {
		p.log.error(`Error during opencode init: ${error}`)
		process.exit(1)
	}
}
