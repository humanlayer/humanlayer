import { mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import * as Predicate from 'effect/Predicate'

import { logger } from '@/logger'
export function requireEnvironment(key: string, defaultValue?: string) {
	const value = process.env[key] ?? defaultValue
	if (!value) throw new Error(`Missing environment variable: ${key}`)
	return value
}

/**
 * Normalize a path: expand ~ to the home directory and resolve relative paths
 * to absolute using the current working directory.
 * @param filePath
 * @returns an absolute path
 */
export function normalizePath(filePath: string) {
	const expanded = filePath.startsWith('~') ? path.join(homedir(), filePath.slice(1)) : filePath
	return path.resolve(expanded)
}

export async function ensureDir(filePath: string) {
	const normalizedFilePath = normalizePath(filePath)

	try {
		await mkdir(normalizedFilePath, { recursive: true })
	} catch (error) {
		logger.error(error, `Failed to create/ensure path exists: ${filePath}`)
		throw error
	}
}

export interface WorkingDirectoryValidation {
	valid: boolean
	error?: string
}

/**
 * Validates that a working directory exists and is actually a directory.
 * Normalizes the path first (expands ~ and resolves relative paths).
 */
export async function validateWorkingDirectory(filePath: string): Promise<WorkingDirectoryValidation> {
	const normalizedPath = normalizePath(filePath)

	try {
		const stats = await stat(normalizedPath)
		if (!stats.isDirectory()) {
			return { valid: false, error: `Path is not a directory: ${filePath}` }
		}
		return { valid: true }
	} catch (err) {
		if (Predicate.hasProperty(err, 'code') && err.code === 'ENOENT') {
			return { valid: false, error: `Working directory does not exist: ${filePath}` }
		}
		return { valid: false, error: `Cannot access working directory: ${filePath}` }
	}
}
