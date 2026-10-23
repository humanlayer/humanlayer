import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { type CollectionConfig, expandPath, getActiveCollection, migrateConfig, type RpiConfig } from '@/lib/rpi-config'
import logger from '@/logger'

// Re-export for convenience
export type { CollectionConfig, RpiConfig }

/**
 * Get the canonical config path: ~/.humanlayer/riptide/config.json
 */
export function getCanonicalConfigPath(): string {
	return join(homedir(), '.humanlayer', 'riptide', 'config.json')
}

/**
 * Load config from canonical path, returns null if not found or invalid.
 * Always returns migrated config (collections format) - legacy fields are normalized.
 */
export async function loadConfig(): Promise<RpiConfig | null> {
	const configPath = getCanonicalConfigPath()

	try {
		await access(configPath)
	} catch {
		return null
	}

	try {
		const content = await readFile(configPath, 'utf-8')
		const rawConfig = JSON.parse(content)
		// Always migrate to ensure collections format - hides legacy fields from callers
		return migrateConfig(rawConfig)
	} catch {
		return null
	}
}

/**
 * Get artifacts repo path with fallback chain:
 * 1. RIPTIDE_RPI_ARTIFACTS_REPO env var (override)
 * 2. Collection resolution based on pwd
 * 3. ~/.humanlayer/riptide/rpi-artifacts (default)
 */
export async function getArtifactsRepoPath(pwd?: string): Promise<string> {
	// Env var takes precedence as override
	const envPath = process.env.RIPTIDE_RPI_ARTIFACTS_REPO
	if (envPath) {
		logger.debug({ envPath }, 'Using artifacts repo from env var')
		return envPath
	}

	// Try config-based resolution (loadConfig always returns migrated format)
	const config = await loadConfig()
	if (config && pwd) {
		try {
			const collection = getActiveCollection(pwd, config)
			const resolvedPath = expandPath(collection.artifactsRepo)
			logger.debug({ pwd, artifactsRepo: resolvedPath }, 'Resolved artifacts repo for PWD')
			return resolvedPath
		} catch (err) {
			logger.debug({ error: err }, 'Failed to resolve collection, using fallback')
		}
	}

	// Default fallback
	return join(homedir(), '.humanlayer', 'riptide', 'rpi-artifacts')
}

/**
 * Get the active collection config for a given PWD.
 * Returns null if no config or no collection resolved.
 */
export async function getActiveCollectionConfig(pwd: string): Promise<CollectionConfig | null> {
	// loadConfig always returns migrated format (collections)
	const config = await loadConfig()
	if (!config) return null

	try {
		return getActiveCollection(pwd, config)
	} catch {
		return null
	}
}
