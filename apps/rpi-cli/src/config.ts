import { execFile } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import chalk from 'chalk'
import * as Predicate from 'effect/Predicate'
import { minimatch } from 'minimatch'

const execFileAsync = promisify(execFile)

async function git(args: string[], cwd: string): Promise<void> {
	await execFileAsync('git', args, { cwd })
}

async function exists(p: string): Promise<boolean> {
	try {
		await access(p)
		return true
	} catch {
		return false
	}
}

export interface CollectionConfig {
	artifactsRepo: string
	linearIntegrationEnabled?: boolean
}

export interface Activation {
	match: string // Bun glob pattern with ~ expansion support
	collection: string
}

/**
 * The migrated config format - all code outside of migrateConfig sees this.
 * Legacy fields (root-level artifactsRepo, linearIntegrationEnabled) are not exposed.
 */
export interface RpiConfig {
	worktree_base_path?: string
	collections?: Record<string, CollectionConfig>
	activations?: Activation[]
	defaultCollection?: string
}

/**
 * Raw config as read from disk - may contain legacy fields.
 * Only used internally by migrateConfig() - not exported.
 */
interface RawRpiConfig extends RpiConfig {
	artifactsRepo?: string
	linearIntegrationEnabled?: boolean
	thoughtsRepo?: string // Very old legacy field
}

export function getDefaultConfigPath(): string {
	// Primary: canonical riptide config path
	return path.join(os.homedir(), '.humanlayer', 'riptide', 'config.json')
}

export function getLegacyConfigPath(): string {
	// Backward compatibility: XDG config path
	const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
	return path.join(xdgConfigHome, 'rpi', 'config.json')
}

export async function getProjectConfigPath(): Promise<string | null> {
	// Look for .rpi.json in current directory or any parent directory
	let currentDir = process.cwd()
	const root = path.parse(currentDir).root

	while (currentDir !== root) {
		const configPath = path.join(currentDir, '.rpi.json')
		if (await exists(configPath)) {
			return configPath
		}
		currentDir = path.dirname(currentDir)
	}

	return null
}

export async function loadRpiConfig(options: { configFile?: string } = {}): Promise<RpiConfig | null> {
	let configPath: string | null = null

	// Priority: 1. CLI flag, 2. Project .rpi.json, 3. Canonical config, 4. Legacy config
	if (options.configFile) {
		configPath = options.configFile
	} else {
		const projectConfig = await getProjectConfigPath()
		if (projectConfig) {
			configPath = projectConfig
		} else {
			// Try canonical path first
			const canonicalPath = getDefaultConfigPath()
			if (await exists(canonicalPath)) {
				configPath = canonicalPath
			} else {
				// Fall back to legacy XDG path
				const legacyPath = getLegacyConfigPath()
				if (await exists(legacyPath)) {
					configPath = legacyPath
				} else {
					return null
				}
			}
		}
	}

	if (!configPath) {
		return null
	}

	try {
		const configContent = await readFile(configPath, 'utf-8')
		let rawConfig = JSON.parse(configContent)

		// Migrate from old config format (thoughtsRepo -> artifactsRepo)
		if (rawConfig.thoughtsRepo && !rawConfig.artifactsRepo) {
			rawConfig = {
				artifactsRepo: rawConfig.thoughtsRepo,
				worktree_base_path: rawConfig.worktree_base_path,
			}
		}

		// Apply collections migration
		return migrateConfig(rawConfig)
	} catch (error) {
		const message = Predicate.isError(error) ? error.message : 'Unknown error'
		console.error(chalk.yellow(`Warning: Could not parse config file ${configPath}: ${message}`))
		return null
	}
}

export async function saveRpiConfig(config: RpiConfig, options: { configFile?: string } = {}): Promise<void> {
	const configPath = options.configFile || getDefaultConfigPath()

	// Create directory if it doesn't exist
	const configDir = path.dirname(configPath)
	await mkdir(configDir, { recursive: true })

	await writeFile(configPath, JSON.stringify(config, null, 2))
}

export function getDefaultArtifactsRepo(): string {
	return path.join(os.homedir(), 'rpi-artifacts')
}

export function expandPath(filePath: string): string {
	if (filePath.startsWith('~/')) {
		return path.join(os.homedir(), filePath.slice(2))
	}
	return path.resolve(filePath)
}

/**
 * Migrate config to collections format.
 * - If only artifactsRepo (no collections): create collections.default from it
 * - If collections exist: legacy root fields are ignored
 * Returns clean RpiConfig without legacy fields.
 */
export function migrateConfig(rawConfig: Partial<RawRpiConfig>): RpiConfig {
	const configuredCollections = rawConfig.collections ?? {}
	const collections = { ...configuredCollections }
	const legacyArtifactsRepo = Object.keys(collections).length === 0 ? rawConfig.artifactsRepo : undefined

	// Only create default collection if NO collections exist at all
	// (This is legacy migration for configs that predate collections)
	if (legacyArtifactsRepo) {
		console.log(chalk.gray('Migrating legacy config to collections format...'))
		collections.default = {
			artifactsRepo: legacyArtifactsRepo,
			linearIntegrationEnabled: rawConfig.linearIntegrationEnabled,
		}
	}

	// Validate that we have at least one collection or artifactsRepo
	const hasCollections = Object.keys(collections).length > 0
	if (!hasCollections && !rawConfig.artifactsRepo) {
		throw new Error('No artifactsRepo configured. Run "rpi init" to set up.')
	}

	// Return clean config without legacy fields
	return {
		worktree_base_path: rawConfig.worktree_base_path,
		collections: hasCollections ? collections : undefined,
		activations: rawConfig.activations,
		defaultCollection: rawConfig.defaultCollection ?? (hasCollections ? 'default' : undefined),
	}
}

/**
 * Check if an activation pattern matches a path.
 * Both pattern and path are tilde-expanded before matching.
 */
export function matchesActivation(activation: Activation, pwd: string): boolean {
	try {
		const normalizedMatch = expandPath(activation.match)
		const normalizedPwd = expandPath(pwd)
		return minimatch(normalizedPwd, normalizedMatch)
	} catch (err) {
		const message = Predicate.isError(err) ? err.message : 'Unknown error'
		console.error(chalk.yellow(`Warning: Invalid glob pattern "${activation.match}": ${message}`))
		return false
	}
}

/**
 * Find the active profile for a given PWD.
 * Returns collection name if matched, null otherwise.
 */
export function activeProfile(pwd: string, config: RpiConfig): string | null {
	for (const activation of config.activations ?? []) {
		if (matchesActivation(activation, pwd)) {
			return activation.collection
		}
	}
	return null
}

/**
 * Get the active collection for a given PWD.
 * Config must be migrated (from loadRpiConfig or migrateConfig).
 * Resolution order:
 * 1. First matching activation (first match wins)
 * 2. config.defaultCollection if set
 * 3. Collection named "default" if exists
 * 4. First collection in collections object
 * 5. Error if no collections exist
 */
export function getActiveCollection(pwd: string, config: RpiConfig): CollectionConfig {
	const migratedConfig = config

	// 1. Check activations
	const activated = activeProfile(pwd, migratedConfig)
	if (activated && migratedConfig.collections?.[activated]) {
		return migratedConfig.collections[activated]
	}

	// 2. defaultCollection
	const defaultCollectionConfig = migratedConfig.defaultCollection
		? migratedConfig.collections?.[migratedConfig.defaultCollection]
		: undefined
	if (defaultCollectionConfig) {
		return defaultCollectionConfig
	}

	// 3. "default" collection
	if (migratedConfig.collections?.default) {
		return migratedConfig.collections.default
	}

	// 4. First collection
	const collectionKeys = Object.keys(migratedConfig.collections ?? {})
	const firstCollectionKey = collectionKeys[0]
	if (firstCollectionKey) {
		const firstCollection = migratedConfig.collections?.[firstCollectionKey]
		if (firstCollection) {
			return firstCollection
		}
	}

	// 5. Error
	throw new Error('No collections configured. Run "rpi init" to set up.')
}

/**
 * Get the resolved artifacts repo path for a given PWD.
 * Convenience wrapper around getActiveCollection.
 */
export function getResolvedArtifactsRepo(pwd: string, config: RpiConfig): string {
	const collection = getActiveCollection(pwd, config)
	return expandPath(collection.artifactsRepo)
}

/**
 * Get the active collection name for a given PWD.
 * Config must be migrated (from loadRpiConfig or migrateConfig).
 * Returns the collection name, not the config.
 */
export function getActiveCollectionName(pwd: string, config: RpiConfig): string {
	const migratedConfig = config

	// Check for empty config after migration
	const hasCollections = migratedConfig.collections && Object.keys(migratedConfig.collections).length > 0
	if (!hasCollections) {
		throw new Error('No collections configured')
	}

	// 1. Check activations
	const activated = activeProfile(pwd, migratedConfig)
	if (activated && migratedConfig.collections?.[activated]) {
		return activated
	}

	// 2. defaultCollection
	if (migratedConfig.defaultCollection && migratedConfig.collections?.[migratedConfig.defaultCollection]) {
		return migratedConfig.defaultCollection
	}

	// 3. "default" collection
	if (migratedConfig.collections?.default) {
		return 'default'
	}

	// 4. First collection
	const collectionKeys = Object.keys(migratedConfig.collections ?? {})
	if (collectionKeys.length > 0 && collectionKeys[0]) {
		return collectionKeys[0]
	}

	throw new Error('No collections configured')
}

export async function ensureArtifactsRepoExists(artifactsRepo: string): Promise<void> {
	const expandedRepo = expandPath(artifactsRepo)

	await mkdir(expandedRepo, { recursive: true })

	// Create tasks directory at root
	const tasksDir = path.join(expandedRepo, 'tasks')
	await mkdir(tasksDir, { recursive: true })

	// Check if we're in a git repo
	const gitPath = path.join(expandedRepo, '.git')
	const gitPathExists = await exists(gitPath)

	if (!gitPathExists) {
		await git(['init'], expandedRepo)
		const gitignore = `# OS files
.DS_Store
Thumbs.db

# Editor files
.vscode/
.idea/
*.swp
*.swo
*~

# Temporary files
*.tmp
*.bak
`
		await writeFile(path.join(expandedRepo, '.gitignore'), gitignore)
		await git(['add', '.gitignore'], expandedRepo)
		await git(['commit', '-m', 'Initial artifacts repository setup'], expandedRepo)
	}
}

export function getTasksPath(artifactsRepo: string): string {
	return path.join(expandPath(artifactsRepo), 'tasks')
}

export function getCurrentRepoPath(): string {
	return process.cwd()
}

export function getRepoNameFromPath(repoPath: string): string {
	const parts = repoPath.split(path.sep)
	return parts[parts.length - 1] || 'unnamed_repo'
}
