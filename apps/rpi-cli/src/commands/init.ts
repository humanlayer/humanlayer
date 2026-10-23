import { access, chmod, lstat, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

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

import {
	expandPath,
	getDefaultArtifactsRepo,
	getResolvedArtifactsRepo,
	getTasksPath,
	loadRpiConfig,
	migrateConfig,
	saveRpiConfig,
} from '../config'

// ============================================================================
// Types
// ============================================================================

interface InitOptions {
	force?: boolean
	local?: string
	upstream?: string
	host?: string
	configFile?: string
	collection?: string
}

interface SetupStatus {
	exists: boolean
	isValid: boolean
	message?: string
}

// ============================================================================
// Git Helpers
// ============================================================================

async function isGitRepo(dir?: string): Promise<boolean> {
	const result = await $`git rev-parse --git-dir`
		.cwd(dir ?? process.cwd())
		.quiet()
		.nothrow()
	return result.exitCode === 0
}

async function hasRemote(repoPath: string): Promise<boolean> {
	const result = await $`git remote get-url origin`.cwd(repoPath).quiet().nothrow()
	return result.exitCode === 0
}

function ghExecEnv(host?: string): NodeJS.ProcessEnv {
	return host ? { ...process.env, GH_HOST: host } : process.env
}

async function ghRepoExists(fullRepoName: string, host?: string): Promise<boolean> {
	const { org, name } = parseRepoName(fullRepoName)
	const result = await $`gh repo list ${org} --json name --jq ${`.[] | select(.name == "${name}") | .name`}`
		.env(ghExecEnv(host))
		.quiet()
		.nothrow()

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString()
		throw new Error(`Failed to check if repo exists: ${stderr}`)
	}
	return result.stdout.toString().trim() === name
}

async function gitPull(repoPath: string): Promise<boolean> {
	const result = await $`git pull --rebase`.cwd(repoPath).quiet().nothrow()
	return result.exitCode === 0
}

async function gitAddCommitPush(repoPath: string, message: string, setUpstream = false): Promise<boolean> {
	try {
		await $`git add .`.cwd(repoPath).quiet()
		await $`git commit -m ${message}`.cwd(repoPath).quiet()
		const branchResult = await $`git branch --show-current`.cwd(repoPath).quiet()
		const currentBranch = branchResult.stdout.toString().trim()

		if (setUpstream) {
			await $`git push -u origin ${currentBranch}`.cwd(repoPath).quiet()
		} else {
			await $`git push`.cwd(repoPath).quiet()
		}
		return true
	} catch {
		return false
	}
}

// ============================================================================
// File Helpers
// ============================================================================

async function ensureTasksDir(repoPath: string): Promise<boolean> {
	const tasksDir = path.join(repoPath, 'tasks')
	if (await exists(tasksDir)) return false

	await mkdir(tasksDir, { recursive: true })
	await writeFile(path.join(tasksDir, '.gitkeep'), '')
	return true
}

// ============================================================================
// Interactive Prompt
// ============================================================================

function prompt(question: string): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close()
			resolve(answer.trim())
		})
	})
}

// ============================================================================
// Upstream Repo Management
// ============================================================================

function parseRepoName(fullRepoName: string): { org: string; name: string } {
	const parts = fullRepoName.split('/')
	if (parts.length !== 2) {
		throw new Error(`Invalid repo format: ${fullRepoName} (expected org/name)`)
	}
	const [org, name] = parts
	if (org === undefined || name === undefined) {
		throw new Error(`Invalid repo format: ${fullRepoName} (expected org/name)`)
	}
	return { org, name }
}

async function ensureUpstreamRepo(fullRepoName: string, localPath: string, host?: string): Promise<void> {
	const { name: repoName } = parseRepoName(fullRepoName)
	const expandedPath = expandPath(localPath)

	if (await ghRepoExists(fullRepoName, host)) {
		await useExistingRepo(fullRepoName, expandedPath, localPath, host)
	} else {
		await createNewRepo(fullRepoName, repoName, expandedPath, host)
	}
}

async function useExistingRepo(
	fullRepoName: string,
	expandedPath: string,
	localPath: string,
	host?: string,
): Promise<void> {
	console.log(chalk.blue(`Found existing repo: ${fullRepoName}`))

	if (await exists(expandedPath)) {
		if (await gitPull(expandedPath)) {
			console.log(chalk.green('✓ Pulled latest from remote'))
		} else {
			console.warn(chalk.yellow('Warning: Could not pull latest'))
		}
	} else {
		console.log(chalk.blue(`Cloning to ${localPath}...`))
		await $`gh repo clone ${fullRepoName} ${expandedPath}`.env(ghExecEnv(host)).quiet()
	}

	if (await ensureTasksDir(expandedPath)) {
		if (await gitAddCommitPush(expandedPath, 'Add tasks directory')) {
			console.log(chalk.green('✓ Added tasks directory'))
		}
	}

	console.log(chalk.green(`✅ Using existing repo: ${fullRepoName}`))
}

async function createNewRepo(
	fullRepoName: string,
	repoName: string,
	expandedPath: string,
	host?: string,
): Promise<void> {
	console.log(chalk.blue(`Creating private GitHub repo: ${fullRepoName}...`))

	try {
		await $`gh repo create ${fullRepoName} --private --clone --description "RPI artifacts repository"`
			.env(ghExecEnv(host))
			.quiet()

		// Move to desired location if cloned elsewhere
		const clonedDir = path.join(process.cwd(), repoName)
		if (clonedDir !== expandedPath) {
			await rename(clonedDir, expandedPath)
		}

		await ensureTasksDir(expandedPath)
		await gitAddCommitPush(expandedPath, 'Initial commit', true)

		console.log(chalk.green(`✅ Created and initialized ${fullRepoName}`))
	} catch (error) {
		const message = Predicate.isError(error) ? error.message : 'Unknown error'
		console.error(chalk.red(`Error creating GitHub repo: ${message}`))
		process.exit(1)
	}
}

// ============================================================================
// Setup Status Check
// ============================================================================

async function checkExistingSetup(): Promise<SetupStatus> {
	const rpiDir = path.join(process.cwd(), 'rpi')

	if (!(await exists(rpiDir))) {
		return { exists: false, isValid: false }
	}

	const rpiStats = await lstat(rpiDir)
	if (!rpiStats.isDirectory()) {
		return { exists: true, isValid: false, message: 'rpi exists but is not a directory' }
	}

	const tasksPath = path.join(rpiDir, 'tasks')
	if (!(await exists(tasksPath))) {
		return { exists: true, isValid: false, message: 'rpi directory exists but tasks symlink is missing or broken' }
	}

	const tasksStats = await lstat(tasksPath)
	if (!tasksStats.isSymbolicLink()) {
		return { exists: true, isValid: false, message: 'rpi directory exists but tasks symlink is missing or broken' }
	}

	return { exists: true, isValid: true }
}

// ============================================================================
// Git Hooks
// ============================================================================

const HOOK_VERSION = '2'

async function setupGitHooks(repoPath: string): Promise<string[]> {
	const gitCommonDir = await getGitCommonDir(repoPath)
	const hooksDir = path.join(gitCommonDir, 'hooks')
	await mkdir(hooksDir, { recursive: true })

	const updated: string[] = []

	if (await installHook(hooksDir, 'pre-commit', preCommitHook(hooksDir))) {
		updated.push('pre-commit')
	}
	if (await installHook(hooksDir, 'post-commit', postCommitHook(hooksDir))) {
		updated.push('post-commit')
	}

	return updated
}

async function getGitCommonDir(repoPath: string): Promise<string> {
	const result = await $`git rev-parse --git-common-dir`.cwd(repoPath).quiet()
	const dir = result.stdout.toString().trim()
	return path.isAbsolute(dir) ? dir : path.join(repoPath, dir)
}

async function installHook(hooksDir: string, name: string, content: string): Promise<boolean> {
	const hookPath = path.join(hooksDir, name)

	if (await exists(hookPath)) {
		const existing = await readFile(hookPath, 'utf-8')
		if (!existing.includes('RPI')) {
			await rename(hookPath, `${hookPath}.old`)
		} else if (!hookNeedsUpdate(existing)) {
			return false
		}
	}

	await writeFile(hookPath, content)
	await chmod(hookPath, '755')
	return true
}

function hookNeedsUpdate(content: string): boolean {
	const match = content.match(/# Version: (\d+)/)
	if (!match) return true
	const [, captured] = match
	if (captured === undefined) return true
	return parseInt(captured, 10) < parseInt(HOOK_VERSION, 10)
}

function preCommitHook(hooksDir: string): string {
	const oldHook = path.join(hooksDir, 'pre-commit.old')
	return `#!/bin/bash
# RPI protection - prevent committing rpi directory
# Version: ${HOOK_VERSION}

if git diff --cached --name-only | grep -q "^rpi/"; then
    echo "❌ Cannot commit rpi/ to code repository"
    echo "The rpi directory should only exist in your separate RPI repository."
    git reset HEAD -- rpi/
    exit 1
fi

if [ -f "${oldHook}" ] && ! grep -q "RPI protection\\|HumanLayer thoughts" "${oldHook}"; then
    "${oldHook}" "$@"
fi
`
}

function postCommitHook(hooksDir: string): string {
	const oldHook = path.join(hooksDir, 'post-commit.old')
	return `#!/bin/bash
# RPI auto-sync
# Version: ${HOOK_VERSION}

[ -f .git ] && exit 0

COMMIT_MSG=$(git log -1 --pretty=%B)
rpi sync --message "Auto-sync with commit: $COMMIT_MSG" >/dev/null 2>&1 &

if [ -f "${oldHook}" ] && ! grep -q "RPI auto-sync\\|HumanLayer thoughts" "${oldHook}"; then
    "${oldHook}" "$@"
fi
`
}

// ============================================================================
// CLAUDE.md Generation
// ============================================================================

function generateClaudeMd(artifactsRepo: string): string {
	const tasksPath = path.join(artifactsRepo, 'tasks').replace(os.homedir(), '~')
	return `# RPI Directory Structure

This directory contains developer research, plans, and implementation notes.
It is managed by the RPI system and should not be committed to the code repository.

## Structure

- \`tasks/\` → Task-specific directories (symlink to ${tasksPath})
  - Each task gets its own directory: \`tasks/eng-XXXX-description/\`
  - Contains: ticket.md, YYYY-MM-DD-research.md, YYYY-MM-DD-plan.md

## Usage

- \`rpi/tasks/\` for task-specific work (plans, research, tickets)
- Files sync automatically when you commit code changes
- Use \`rpi sync\` to manually sync, \`rpi status\` to check status

## Important

- Never commit the rpi/ directory to your code repository
- The git pre-commit hook will prevent accidental commits
`
}

// ============================================================================
// Main Init Command
// ============================================================================

export async function initCommand(options: InitOptions): Promise<void> {
	try {
		if (!(await isGitRepo())) {
			console.error(chalk.red('Error: Not in a git repository'))
			process.exit(1)
		}

		const currentRepo = process.cwd()
		let config = await loadRpiConfig(options)

		// First-time setup: create/load artifacts repo
		if (!config) {
			config = await setupFirstTimeConfig(options)
		}

		// Handle --collection flag
		if (options.collection) {
			const migratedConfig = migrateConfig(config)
			if (!migratedConfig.collections?.[options.collection]) {
				const available = Object.keys(migratedConfig.collections ?? {})
				console.error(chalk.red(`Collection "${options.collection}" does not exist.`))
				if (available.length > 0) {
					console.error(chalk.yellow(`Available collections: ${available.join(', ')}`))
				} else {
					console.error(
						chalk.yellow('No collections configured. Add collections to ~/.humanlayer/riptide/config.json'),
					)
				}
				process.exit(1)
			}

			// Add activation for this directory (avoid duplicates)
			const pwd = process.cwd()
			config.activations = config.activations ?? []
			const existingIndex = config.activations.findIndex((a) => a.match === pwd)
			if (existingIndex >= 0) {
				config.activations[existingIndex] = { match: pwd, collection: options.collection }
				console.log(chalk.blue(`Updated activation for ${pwd} → ${options.collection}`))
			} else {
				config.activations.push({ match: pwd, collection: options.collection })
				console.log(chalk.blue(`Added activation for ${pwd} → ${options.collection}`))
			}
			await saveRpiConfig(config, options)
		}

		// Check if already configured
		const setupStatus = await checkExistingSetup()
		if (setupStatus.exists && !options.force) {
			if (setupStatus.isValid) {
				console.log(chalk.green('✅ RPI already configured for this repository.'))
				console.log(chalk.gray('Use --force to reconfigure.'))
				return
			}
			console.log(chalk.yellow(`⚠️  ${setupStatus.message} - fixing...`))
		}

		// Get the resolved artifacts repo for this PWD
		const pwd = process.cwd()
		let resolvedArtifactsRepo: string
		if (options.collection) {
			const collection = migrateConfig(config).collections?.[options.collection]
			if (!collection) {
				throw new Error(`Collection "${options.collection}" not found in config`)
			}
			resolvedArtifactsRepo = expandPath(collection.artifactsRepo)
		} else {
			resolvedArtifactsRepo = getResolvedArtifactsRepo(pwd, config)
		}

		// Verify artifacts repo exists (use Node's fs.access instead of Bun's file().exists()
		// because file().exists() can fail in compiled binaries)
		try {
			await access(resolvedArtifactsRepo)
		} catch {
			console.error(chalk.red(`Error: Artifacts repository not found at ${resolvedArtifactsRepo}`))
			process.exit(1)
		}

		// Setup local rpi directory
		await setupLocalRpiDir(currentRepo, resolvedArtifactsRepo)

		// Pull latest from remote if available
		if ((await hasRemote(resolvedArtifactsRepo)) && (await gitPull(resolvedArtifactsRepo))) {
			console.log(chalk.green('✓ Pulled latest artifacts from remote'))
		}

		// Setup git hooks
		const updatedHooks = await setupGitHooks(currentRepo)
		if (updatedHooks.length > 0) {
			console.log(chalk.yellow(`✓ Updated git hooks: ${updatedHooks.join(', ')}`))
		}

		printSummary(currentRepo, resolvedArtifactsRepo)
	} catch (error) {
		const message = Predicate.isError(error) ? error.message : 'Unknown error'
		console.error(chalk.red(`Error during rpi init: ${message}`))
		process.exit(1)
	}
}

async function setupFirstTimeConfig(options: InitOptions) {
	// Get local path
	const localPath =
		options.local ||
		(await prompt(`Local artifacts path [${getDefaultArtifactsRepo()}]: `)) ||
		getDefaultArtifactsRepo()

	const expandedPath = expandPath(localPath)

	// Check if repo already exists with upstream
	if ((await exists(expandedPath)) && (await hasRemote(expandedPath))) {
		console.log(chalk.blue(`Using existing repo at ${localPath}`))
		await ensureTasksDir(expandedPath)
	} else {
		// Need upstream repo
		const upstream = options.upstream || (await prompt('GitHub repo to create/clone (org/name): '))
		if (!upstream) {
			console.error(chalk.red('Error: --upstream is required for first-time setup'))
			console.error(chalk.gray('Example: rpi init --local ~/my-artifacts --upstream myorg/rpi-artifacts'))
			process.exit(1)
		}
		await ensureUpstreamRepo(upstream, localPath, options.host)
	}

	const config = {
		collections: {
			default: {
				artifactsRepo: localPath,
			},
		},
		defaultCollection: 'default',
	}
	await saveRpiConfig(config, options)
	console.log(chalk.green(`✅ Global config saved (artifacts at ${localPath})`))

	return config
}

async function setupLocalRpiDir(currentRepo: string, artifactsRepo: string): Promise<void> {
	const rpiDir = path.join(currentRepo, 'rpi')

	// Clean and recreate
	await rm(rpiDir, { recursive: true, force: true })
	await mkdir(rpiDir)

	// Create tasks symlink
	await symlink(getTasksPath(artifactsRepo), path.join(rpiDir, 'tasks'), 'dir')

	// Write CLAUDE.md
	await writeFile(path.join(rpiDir, 'CLAUDE.md'), generateClaudeMd(artifactsRepo))
}

function printSummary(currentRepo: string, artifactsRepo: string): void {
	console.log(chalk.green('✅ RPI setup complete!'))
	console.log('')
	console.log(`${chalk.cyan(currentRepo)}/rpi/tasks/ → ${chalk.gray(`${artifactsRepo}/tasks/`)}`)
	console.log('')
	console.log(chalk.gray('Next: Create task directories in rpi/tasks/eng-XXXX-description/'))
}
