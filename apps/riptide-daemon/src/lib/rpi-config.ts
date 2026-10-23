// The RPI config format (collections, activations) and its resolution rules, moved here from the
// retired rpi-cli. The daemon reads ~/.humanlayer/riptide/config.json in this format (see config.ts).

import os from 'node:os'
import path from 'node:path'

import * as Predicate from 'effect/Predicate'
import { minimatch } from 'minimatch'

import logger from '@/logger'

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
		logger.info('Migrating legacy config to collections format')
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
function matchesActivation(activation: Activation, pwd: string): boolean {
	try {
		const normalizedMatch = expandPath(activation.match)
		const normalizedPwd = expandPath(pwd)
		return minimatch(normalizedPwd, normalizedMatch)
	} catch (err) {
		const message = Predicate.isError(err) ? err.message : 'Unknown error'
		logger.warn({ match: activation.match, message }, 'Invalid glob pattern in config activation')
		return false
	}
}

/**
 * Get the active collection for a given PWD.
 * Config must be migrated (from migrateConfig).
 * Resolution order:
 * 1. First matching activation (first match wins)
 * 2. config.defaultCollection if set
 * 3. Collection named "default" if exists
 * 4. First collection in collections object
 * 5. Error if no collections exist
 */
export function getActiveCollection(pwd: string, config: RpiConfig): CollectionConfig {
	// 1. Check activations
	const activated = config.activations?.find((activation) => matchesActivation(activation, pwd))?.collection
	if (activated && config.collections?.[activated]) {
		return config.collections[activated]
	}

	// 2. defaultCollection
	const defaultCollectionConfig = config.defaultCollection
		? config.collections?.[config.defaultCollection]
		: undefined
	if (defaultCollectionConfig) {
		return defaultCollectionConfig
	}

	// 3. "default" collection
	if (config.collections?.default) {
		return config.collections.default
	}

	// 4. First collection
	const firstCollection = Object.values(config.collections ?? {})[0]
	if (firstCollection) {
		return firstCollection
	}

	// 5. Error
	throw new Error('No collections configured. Run "rpi init" to set up.')
}
