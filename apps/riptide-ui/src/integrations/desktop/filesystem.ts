import type { FileMatch, FilesystemDirectory } from '@humanlayer/riptide-electron-rpc'
import { Option, Schema } from 'effect'
import { useCallback, useRef, useState } from 'react'

import * as electronFilesystem from '@/integrations/electron/filesystem'
import * as tauriFilesystem from '@/integrations/tauri/filesystem'
import { logger } from '@/lib/logger'
import { isElectron, isTauri } from '@/lib/utils'

export interface DirectoryValidationResult {
	valid: boolean
	error?: string
}

export async function getHomeDirectory(): Promise<string | null> {
	if (isElectron()) return electronFilesystem.getHomeDirectory()
	if (isTauri()) return tauriFilesystem.getHomeDirectory()
	return null
}

const expandTilde = async (path: string) => {
	if (!path.startsWith('~')) return path
	const home = await getHomeDirectory()
	return home === null ? path : path.replace(/^~(?=$|\/|\\)/, home)
}

export async function resolveLocalPath(path: string): Promise<string> {
	return expandTilde(path)
}

export async function pathExists(path: string): Promise<boolean> {
	if (isElectron()) return (await electronFilesystem.statPath(path)).exists
	if (isTauri()) return (await tauriFilesystem.statPath(path)).exists
	return false
}

export async function readTextFile(path: string): Promise<string> {
	const expandedPath = await expandTilde(path)
	if (isElectron()) return electronFilesystem.readTextFile(expandedPath)
	if (isTauri()) return tauriFilesystem.readTextFile(expandedPath)
	throw new Error('Reading local files requires a desktop host')
}

const MIME_EXTENSIONS = ['gif', 'jpeg', 'jpg', 'json', 'md', 'pdf', 'png', 'svg', 'txt', 'webp'] as const
const MimeExtension = Schema.Literals(MIME_EXTENSIONS)

const MIME_TYPES_BY_EXTENSION: Record<(typeof MIME_EXTENSIONS)[number], string> = {
	gif: 'image/gif',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	json: 'application/json',
	md: 'text/markdown',
	pdf: 'application/pdf',
	png: 'image/png',
	svg: 'image/svg+xml',
	txt: 'text/plain',
	webp: 'image/webp',
}

export async function readDroppedPathsAsFiles(paths: string[]): Promise<File[]> {
	if (!isElectron() && !isTauri()) return []
	const files = await Promise.all(
		paths.map(async (path) => {
			try {
				const bytes = isElectron()
					? await electronFilesystem.readFile(path)
					: await tauriFilesystem.readFile(path)
				const name = path.split(/[\\/]/).pop() || path
				const extension = name.split('.').pop()?.toLowerCase() ?? ''
				const mimeExtension = Option.getOrUndefined(Schema.decodeUnknownOption(MimeExtension)(extension))
				const type =
					mimeExtension === undefined ? 'application/octet-stream' : MIME_TYPES_BY_EXTENSION[mimeExtension]
				return new File([bytes as BlobPart], name, { type })
			} catch (error) {
				logger.warn('Could not read a dropped file', {
					path,
					error: error instanceof Error ? error.message : String(error),
				})
				return null
			}
		}),
	)
	return files.filter((file): file is File => file !== null)
}

export async function validateDirectoryExists(path: string): Promise<DirectoryValidationResult> {
	if (!isElectron() && !isTauri()) return { valid: true }
	if (!path.trim()) return { valid: false, error: 'Directory is required' }
	try {
		const expandedPath = await expandTilde(path)
		const result = isElectron()
			? await electronFilesystem.statPath(expandedPath)
			: await tauriFilesystem.statPath(expandedPath)
		if (!result.exists) return { valid: false, error: 'Directory does not exist' }
		return result.isDirectory ? { valid: true } : { valid: false, error: 'Path is not a directory' }
	} catch {
		return { valid: false, error: 'Directory does not exist' }
	}
}

export async function fuzzySearchFiles(query: string, paths: string[], limit?: number): Promise<FileMatch[]> {
	if (!isElectron() && !isTauri()) return []
	try {
		const expandedPaths = await Promise.all(paths.map(expandTilde))
		if (isElectron()) {
			return (await electronFilesystem.fuzzySearchFiles({ query, paths: expandedPaths, limit })).map((match) => ({
				...match,
				matched_indexes: [...match.matched_indexes],
			}))
		}
		return await tauriFilesystem.fuzzySearchFiles(query, expandedPaths, limit)
	} catch (error) {
		logger.error('[filesystem] fuzzySearchFiles failed:', error)
		return []
	}
}

/** True when the query is an absolute or `~`-relative path rather than a fuzzy term. */
export function isPathLikeQuery(query: string): boolean {
	return query.startsWith('/') || query === '~' || query.startsWith('~/')
}

/**
 * Splits a typed path into the directory to list and the prefix to filter its
 * entries by, on the last separator. A path that ends in a separator yields an
 * empty prefix, which lists the directory in full — the gesture that makes a
 * name containing spaces reachable, since it never has to be typed.
 */
export function splitPathQuery(path: string): { directory: string; prefix: string } {
	const lastSlash = path.lastIndexOf('/')
	if (lastSlash === -1) return { directory: path, prefix: '' }
	return { directory: lastSlash === 0 ? '/' : path.slice(0, lastSlash), prefix: path.slice(lastSlash + 1) }
}

/**
 * Resolves a typed absolute or `~` path into mention candidates by listing its
 * parent directory and filtering on the last segment. The cost is bounded by
 * that one directory rather than by a recursive scan budget, so completing a
 * path anywhere on the host stays both cheap and complete.
 */
export async function searchPathQuery(query: string, limit?: number): Promise<FileMatch[]> {
	if (!isElectron() && !isTauri()) return []
	try {
		// A bare `~` names the home directory rather than a segment to complete,
		// so list it instead of filtering its parent by the user's own name.
		const expanded = await expandTilde(query === '~' ? '~/' : query)
		if (!expanded.startsWith('/')) return []
		const { directory, prefix } = splitPathQuery(expanded)
		const input = { path: directory, prefix, limit }
		if (isElectron()) {
			return (await electronFilesystem.listDirectory(input)).map((match) => ({
				...match,
				matched_indexes: [...match.matched_indexes],
			}))
		}
		return await tauriFilesystem.listDirectory(input)
	} catch (error) {
		logger.error('[filesystem] searchPathQuery failed:', error)
		return []
	}
}

export function useFilesystemBrowser() {
	const [directories, setDirectories] = useState<FilesystemDirectory[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [basePath, setBasePath] = useState('')
	const cacheRef = useRef(new Map<string, FilesystemDirectory[]>())

	const browse = useCallback(async (searchPath: string) => {
		if (!isElectron() && !isTauri()) {
			setDirectories([])
			return
		}
		setIsLoading(true)
		setError(null)
		await (async () => {
			const expandedPath = await expandTilde(searchPath)
			const lastSlashIndex = expandedPath.lastIndexOf('/')
			const currentBasePath = lastSlashIndex === -1 ? '' : expandedPath.substring(0, lastSlashIndex + 1)
			setBasePath(currentBasePath)
			const cached = cacheRef.current.get(currentBasePath)
			if (cached) {
				setDirectories(cached)
				return
			}
			const pathToRead = currentBasePath || '/'
			const entries = await (
				isElectron()
					? electronFilesystem.browseDirectories(pathToRead).then((results) => [...results])
					: tauriFilesystem.browseDirectories(pathToRead)
			).catch(() => null)
			if (entries === null) {
				setError('Could not read directory')
				return
			}
			cacheRef.current.set(currentBasePath, entries)
			setDirectories(entries)
		})().finally(() => setIsLoading(false))
	}, [])

	return { directories, isLoading, error, basePath, browse }
}

export type { FileMatch, FilesystemDirectory } from '@humanlayer/riptide-electron-rpc'
