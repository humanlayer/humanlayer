import type { FileMatch, FilesystemDirectory, PathStat } from '@humanlayer/riptide-electron-rpc'
import { invoke } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'
import type { DirEntry } from '@tauri-apps/plugin-fs'
import { readDir, readFile as readTauriFile, readTextFile as readTauriTextFile, stat } from '@tauri-apps/plugin-fs'
import { useCallback, useRef, useState } from 'react'

import { logger } from '@/lib/logger'
import { isTauri } from '@/lib/utils'

export const getHomeDirectory = (): Promise<string> => homeDir()

export async function statPath(path: string): Promise<PathStat> {
	try {
		const fileStat = await stat(path)
		return { exists: true, isDirectory: fileStat.isDirectory, isFile: fileStat.isFile }
	} catch {
		return { exists: false, isDirectory: false, isFile: false }
	}
}

export const readTextFile = (path: string): Promise<string> => readTauriTextFile(path)

export const readFile = (path: string): Promise<Uint8Array> => readTauriFile(path)

export async function browseDirectories(path: string): Promise<FilesystemDirectory[]> {
	const entries = await readDir(path)
	return entries.reduce<FilesystemDirectory[]>((directories, entry) => {
		if (entry.isDirectory) {
			directories.push({ name: entry.name || '', path: `${path.replace(/\/$/, '')}/${entry.name || ''}` })
		}
		return directories
	}, [])
}

export interface UseFilesystemBrowserResult {
	directories: FilesystemDirectory[]
	isLoading: boolean
	error: string | null
	basePath: string
	browse: (searchPath: string) => Promise<void>
}

/**
 * Hook for browsing filesystem directories in Tauri environment.
 * Returns empty results in web mode (graceful degradation).
 */
export function useFilesystemBrowser(): UseFilesystemBrowserResult {
	const [directories, setDirectories] = useState<FilesystemDirectory[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [basePath, setBasePath] = useState('')

	// Cache to avoid repeated directory reads
	const cacheRef = useRef<Map<string, FilesystemDirectory[]>>(new Map())

	const browse = useCallback(async (searchPath: string) => {
		// No-op in web mode
		if (!isTauri()) {
			setDirectories([])
			return
		}

		try {
			let expandedPath = searchPath

			// Handle tilde expansion
			if (expandedPath.startsWith('~')) {
				const home = await homeDir()
				expandedPath = expandedPath.replace(/^~(?=$|\/|\\)/, home)
			}

			// Parse path into base directory + search term
			const lastSlashIdx = expandedPath.lastIndexOf('/')
			const currentBasePath = lastSlashIdx === -1 ? '' : expandedPath.substring(0, lastSlashIdx + 1)

			setBasePath(currentBasePath)

			// Check cache
			if (cacheRef.current.has(currentBasePath)) {
				const cached = cacheRef.current.get(currentBasePath)
				if (cached) setDirectories(cached)
				return
			}

			setIsLoading(true)
			setError(null)

			try {
				const pathToRead = currentBasePath || '/'
				const entries = await readDir(pathToRead)

				const dirs: FilesystemDirectory[] = entries
					.filter((entry: DirEntry) => entry.isDirectory)
					.map((entry: DirEntry) => ({
						name: entry.name || '',
						path: currentBasePath + (entry.name || ''),
					}))

				// Update cache
				cacheRef.current.set(currentBasePath, dirs)
				setDirectories(dirs)
			} catch {
				// Keep showing last valid directories on read error
				setError(`Could not read directory: ${currentBasePath}`)
			}
		} catch {
			setError('Filesystem browsing not available')
		} finally {
			setIsLoading(false)
		}
	}, [])

	return {
		directories,
		isLoading,
		error,
		basePath,
		browse,
	}
}

export interface DirectoryValidationResult {
	valid: boolean
	error?: string
}

/**
 * Validates that a directory path exists and is a directory.
 * In web mode, returns valid: true (validation happens on daemon).
 * Handles tilde expansion before checking.
 */
export async function validateDirectoryExists(path: string): Promise<DirectoryValidationResult> {
	// No validation in web mode - daemon will catch it
	if (!isTauri()) {
		return { valid: true }
	}

	if (!path.trim()) {
		return { valid: false, error: 'Directory is required' }
	}

	try {
		let expandedPath = path

		// Handle tilde expansion
		if (expandedPath.startsWith('~')) {
			const home = await homeDir()
			expandedPath = expandedPath.replace(/^~(?=$|\/|\\)/, home)
		}

		const stats = await stat(expandedPath)

		if (!stats.isDirectory) {
			return { valid: false, error: 'Path is not a directory' }
		}

		return { valid: true }
	} catch {
		return { valid: false, error: 'Directory does not exist' }
	}
}

export async function getProcessCwd(): Promise<string | null> {
	if (!isTauri()) return null
	try {
		return await invoke<string>('get_process_cwd')
	} catch (error) {
		logger.error('[filesystem] getProcessCwd failed:', error)
		return null
	}
}

// ---- Fuzzy file search ----

/**
 * Fuzzy search for files across one or more directory paths.
 * Runs in Rust via Tauri command — uses ignore crate (gitignore, symlink cycle detection)
 * and nucleo-matcher (fzf-style scoring).
 * Returns empty array in web mode.
 */
export async function fuzzySearchFiles(query: string, paths: string[], limit?: number): Promise<FileMatch[]> {
	if (!isTauri()) return []
	try {
		// Expand tilde in paths — Rust's Path doesn't understand shell tilde expansion
		const expandedPaths = await Promise.all(
			paths.map(async (p) => {
				if (p.startsWith('~')) {
					const home = await homeDir()
					return p.replace(/^~(?=$|\/|\\)/, home)
				}
				return p
			}),
		)

		return await invoke<FileMatch[]>('fuzzy_search_files', { query, paths: expandedPaths, limit })
	} catch (error) {
		logger.error('[filesystem] fuzzySearchFiles failed:', error)
		return []
	}
}

const DEFAULT_LIST_LIMIT = 100

/**
 * Lists one directory without recursion, keeping the entries whose name starts
 * with `prefix`. Mirrors the Electron `ListDirectory` RPC; `readDir` already
 * reports the entry type, so no extra stat per entry is needed.
 */
export async function listDirectory(input: { path: string; prefix?: string; limit?: number }): Promise<FileMatch[]> {
	if (!isTauri()) return []
	const prefix = input.prefix ?? ''
	const entries = await readDir(input.path)

	// Dot entries stay hidden until the typed segment asks for them, the same
	// rule a shell follows.
	const includeHidden = prefix.startsWith('.')
	const normalizedPrefix = prefix.toLowerCase()
	const base = input.path.replace(/\/$/, '')

	const matches = entries.reduce<FileMatch[]>((collected, entry) => {
		const name = entry.name || ''
		if (!name) return collected
		if (!includeHidden && name.startsWith('.')) return collected
		if (!name.toLowerCase().startsWith(normalizedPrefix)) return collected
		const path = `${base}/${name}`
		const offset = path.length - name.length
		collected.push({
			path,
			// Bare name: the directory is already visible in what the user typed,
			// and the row truncates its tail, which would hide the name itself.
			display_path: name,
			score: 0,
			// Indexed against `path`, as every other producer of FileMatch does.
			matched_indexes: Array.from({ length: prefix.length }, (_, index) => offset + index),
			is_directory: entry.isDirectory,
		})
		return collected
	}, [])

	matches.sort((left, right) => {
		if (left.is_directory !== right.is_directory) return left.is_directory ? -1 : 1
		return left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' })
	})
	return matches.slice(0, input.limit ?? DEFAULT_LIST_LIMIT)
}
