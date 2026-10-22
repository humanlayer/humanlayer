import { access, chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import logger from '@/logger'

import { HUMANLAYER_PLUGIN_VERSION, humanlayerEmbeddedFiles } from './bundled-humanlayer-plugin'
import { embeddedFiles, PLUGIN_VERSION } from './bundled-rpi-plugin'

/**
 * Default base directory for Riptide plugins
 */
const DEFAULT_PLUGINS_DIR = join(homedir(), '.humanlayer', 'riptide', 'plugins')
const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const pendingPluginWrites = new Map<string, Promise<string>>()

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path)
		return true
	} catch {
		return false
	}
}

/**
 * Check if running in dev mode (watch/hot mode, development build, or forced via env)
 */
function isDevMode(): boolean {
	return process.env.RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN === 'true'
}

/**
 * Get source plugin path relative to this file's location.
 * Returns the path to apps/riptide-rpi-claude-plugin/ in the monorepo.
 */
function getSourcePluginPath(): string {
	// This file is at: apps/riptide-daemon/src/plugins/ensure-plugin.ts
	// Plugin is at: apps/riptide-rpi-claude-plugin/
	// Go up 3 levels to apps/, then into riptide-rpi-claude-plugin/
	return join(MODULE_DIRECTORY, '..', '..', '..', 'riptide-rpi-claude-plugin')
}

function getSourceHumanlayerPluginPath(): string {
	return join(MODULE_DIRECTORY, '..', '..', '..', 'riptide-humanlayer-claude-plugin')
}

/**
 * Get the path where the RPI plugin should be written
 * @param baseDir - Optional base directory for plugins (defaults to ~/.humanlayer/riptide/plugins)
 */
export function getRpiPluginPath(baseDir?: string): string {
	// PLUGIN_VERSION is derived and stamped at release build time
	// (ci-scripts/stamp-plugin-versions.ts), so released daemons always get a
	// fresh dir when plugin content changed; local dev serves from source via
	// RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN and never uses this path
	return join(baseDir ?? DEFAULT_PLUGINS_DIR, 'riptide-rpi', PLUGIN_VERSION)
}

export function getHumanlayerPluginPath(baseDir?: string): string {
	return join(baseDir ?? DEFAULT_PLUGINS_DIR, 'riptide-humanlayer', HUMANLAYER_PLUGIN_VERSION)
}

async function writeEmbeddedPluginFiles(
	pluginsDir: string,
	pluginDir: string,
	tempPrefix: string,
	files: Record<string, string>,
): Promise<string> {
	const tempDir = join(pluginsDir, `.${tempPrefix}-temp-${crypto.randomUUID()}`)

	for (const [relativePath, embeddedPath] of Object.entries(files)) {
		const content = await readFile(embeddedPath, 'utf-8')
		const fullPath = join(tempDir, relativePath)
		await mkdir(dirname(fullPath), { recursive: true })
		await writeFile(fullPath, content, 'utf-8')
		if (relativePath.startsWith('skills/') && relativePath.includes('/scripts/') && relativePath.endsWith('.sh')) {
			await chmod(fullPath, 0o755)
		}
	}

	await mkdir(dirname(pluginDir), { recursive: true })

	try {
		await rename(tempDir, pluginDir)
	} catch (err) {
		await rm(tempDir, { recursive: true, force: true })
		const code = (err as NodeJS.ErrnoException).code
		if (code === 'ENOTEMPTY' || code === 'EEXIST') {
			return pluginDir
		}
		throw err
	}

	return pluginDir
}

/**
 * Ensures the bundled RPI plugin is written to disk.
 *
 * Priority:
 * 1. Explicit path (RIPTIDE_RPI_PLUGIN_PATH): uses specified absolute path
 * 2. Dev mode (RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN=true): uses source plugin relative to daemon
 * 3. Bundled plugin: writes embedded files to ~/.humanlayer/riptide/plugins/
 *
 * @param baseDir - Optional base directory for plugins (defaults to ~/.humanlayer/riptide/plugins)
 * @returns The path to the plugin directory
 */
export async function ensureRpiPluginOnDisk(baseDir?: string): Promise<string> {
	// Explicit path override takes highest priority
	const explicitDevPath = process.env.RIPTIDE_RPI_PLUGIN_PATH
	if (explicitDevPath) {
		return explicitDevPath
	}

	// Dev mode: use source plugin directory relative to daemon location
	if (isDevMode()) {
		const sourcePluginPath = getSourcePluginPath()
		if (await pathExists(sourcePluginPath)) {
			return sourcePluginPath
		}
		logger.warn({ sourcePluginPath }, 'Dev mode detected but source plugin not found, falling back to bundled')
	}

	const pluginsDir = baseDir ?? DEFAULT_PLUGINS_DIR
	const pluginDir = getRpiPluginPath(baseDir)

	// Fast path: plugin already exists
	if (await pathExists(pluginDir)) {
		return pluginDir
	}

	const pending = pendingPluginWrites.get(pluginDir)
	if (pending) {
		return pending
	}

	const writePromise = writeEmbeddedPluginFiles(pluginsDir, pluginDir, 'riptide-rpi', embeddedFiles)

	pendingPluginWrites.set(pluginDir, writePromise)

	try {
		return await writePromise
	} finally {
		if (pendingPluginWrites.get(pluginDir) === writePromise) {
			pendingPluginWrites.delete(pluginDir)
		}
	}
}

export async function ensureHumanlayerPluginOnDisk(baseDir?: string): Promise<string> {
	const explicitDevPath = process.env.RIPTIDE_HUMANLAYER_PLUGIN_PATH
	if (explicitDevPath) return explicitDevPath

	if (isDevMode()) {
		const sourcePluginPath = getSourceHumanlayerPluginPath()
		if (await pathExists(sourcePluginPath)) return sourcePluginPath
		logger.warn({ sourcePluginPath }, 'Dev mode detected but HumanLayer plugin not found, falling back to bundled')
	}

	const pluginsDir = baseDir ?? DEFAULT_PLUGINS_DIR
	const pluginDir = getHumanlayerPluginPath(baseDir)
	if (await pathExists(pluginDir)) return pluginDir

	const pending = pendingPluginWrites.get(pluginDir)
	if (pending) return pending

	const writePromise = writeEmbeddedPluginFiles(pluginsDir, pluginDir, 'riptide-humanlayer', humanlayerEmbeddedFiles)
	pendingPluginWrites.set(pluginDir, writePromise)

	try {
		return await writePromise
	} finally {
		if (pendingPluginWrites.get(pluginDir) === writePromise) pendingPluginWrites.delete(pluginDir)
	}
}
