import * as Predicate from 'effect/Predicate'
import { toast } from 'sonner'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { openInEditor } from '@/integrations/desktop/editor'
import { pathExists, resolveLocalPath } from '@/integrations/desktop/filesystem'
import { captureException } from '@/integrations/sentry/sentry'
import { logger } from '@/lib/logger'
import { isDesktop } from '@/lib/utils'

interface OpenFileOptions {
	filePath: string
	workingDir?: string
	/**
	 * Workspace root for multi-repo tasks (the user's expanded local base, or
	 * the task snapshot's `~`-prefixed base). When provided, a relative path
	 * that doesn't exist under workingDir is also probed against this base and
	 * the first existing candidate opens — so workspace-root-relative links
	 * like `agentlayer/src/index.ts` land on the right repo's file. Absent for
	 * single-repo / legacy tasks, where behavior is unchanged.
	 */
	workspaceBaseDir?: string
}

/**
 * Check if a path is absolute (starts with / on Unix or drive letter on Windows)
 */
function isAbsolutePath(filePath: string): boolean {
	return filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath)
}

/**
 * Join path segments, handling both Unix and Windows separators
 */
function joinPath(base: string, relative: string): string {
	const separator = base.includes('\\') ? '\\' : '/'
	const cleanBase = base.endsWith(separator) ? base.slice(0, -1) : base
	const cleanRelative = relative.startsWith(separator) ? relative.slice(1) : relative
	return `${cleanBase}${separator}${cleanRelative}`
}

/**
 * Get the basename of a file path
 */
function basename(filePath: string): string {
	const parts = filePath.split(/[\\/]/)
	return parts[parts.length - 1] || filePath
}

/**
 * Resolve a relative file path to the path we hand the editor.
 *
 * Without a workspace base (single-repo / legacy / web) this is exactly
 * today's behavior: join against the working directory. With a workspace
 * base (multi-repo tasks, Tauri only) the candidate chain
 * `join(workingDir, path)` → `join(workspaceBaseDir, path)` is probed with
 * `stat` and the first existing candidate wins; when neither exists we fall
 * back to the working-directory join so the existing error surfacing applies.
 */
async function resolveRelativeFilePath({
	filePath,
	workingDir,
	workspaceBaseDir,
}: {
	filePath: string
	workingDir?: string
	workspaceBaseDir?: string
}): Promise<string> {
	const fallback = workingDir ? joinPath(workingDir, filePath) : filePath
	if (!workspaceBaseDir || !isDesktop()) return fallback

	const candidates: string[] = []
	if (workingDir) candidates.push(joinPath(workingDir, filePath))
	candidates.push(joinPath(await resolveLocalPath(workspaceBaseDir), filePath))

	for (const candidate of candidates) {
		if (await pathExists(candidate)) return candidate
	}
	return fallback
}

/**
 * Opens a file in the user's preferred editor.
 *
 * In Tauri (desktop) environment:
 * - Uses the native `open_in_editor` command
 * - Supports cursor, code, zed, or system default
 * - For multi-repo tasks, relative paths are probed against the working
 *   directory and then the workspace root (see resolveRelativeFilePath)
 *
 * In browser environment:
 * - Falls back to copying the path to clipboard (future: VSCode URI scheme)
 */
/**
 * Opens a working directory in the user's preferred editor (Tauri only).
 *
 * Shared by the task/session `⌘⇧O` hotkeys and the matching command palette
 * actions so error surfacing stays identical across surfaces.
 */
export function openWorkingDirectoryInEditor(workingDirectory: string): void {
	const editor = useSettingsStore.getState().defaultEditor
	openInEditor({
		path: workingDirectory,
		editor: editor === 'system' ? null : editor,
	})
		.then(() => {
			toast.success(`Opened ${workingDirectory} - configure default editor in settings (⌘,)`)
		})
		.catch((error) => {
			// Tauri returns errors as plain strings, not Error objects
			const errorMessage = Predicate.isString(error)
				? error
				: Predicate.isError(error)
					? error.message
					: 'Unknown error'
			logger.error('Failed to open working directory in editor', error)

			if (errorMessage.includes('does not exist')) {
				toast.error('Directory not found', {
					description: 'The working directory no longer exists',
				})
			} else if (errorMessage.includes('is not installed')) {
				// Backend already provides a helpful message with a download link
				toast.error('Editor not found', {
					description: errorMessage,
				})
			} else {
				toast.error('Failed to open editor', {
					description: errorMessage,
				})
			}
		})
}

/** The path the editor would open: relative paths join the working directory (or workspace root). */
function resolveFilePath({ filePath, workingDir, workspaceBaseDir }: OpenFileOptions): Promise<string> {
	return isAbsolutePath(filePath)
		? Promise.resolve(filePath)
		: resolveRelativeFilePath({ filePath, workingDir, workspaceBaseDir })
}

/**
 * Copies the path `openFileInEditor` would open. Desktop resolves it to an absolute path when the
 * file exists under the workspace root; otherwise it keeps the working directory's `~/…` form.
 */
export async function copyFilePath(options: OpenFileOptions): Promise<void> {
	const fullPath = await resolveFilePath(options)
	try {
		await navigator.clipboard.writeText(fullPath)
		toast.success('Copied file path', { description: fullPath })
	} catch (error) {
		logger.error('Failed to copy file path to clipboard:', error)
		toast.error('Could not copy file path', { description: 'Clipboard access was denied. Try again.' })
	}
}

export async function openFileInEditor({ filePath, workingDir, workspaceBaseDir }: OpenFileOptions): Promise<void> {
	// Resolve relative paths against working directory (and workspace root for multi-repo tasks)
	const fullPath = await resolveFilePath({ filePath, workingDir, workspaceBaseDir })

	if (isDesktop()) {
		const editor = useSettingsStore.getState().defaultEditor

		try {
			await openInEditor({
				path: fullPath,
				editor: editor === 'system' ? null : editor,
			})

			const editorName = editor === 'system' ? 'default editor' : editor
			const configureHint = editor === 'system' ? ' (configure editor in settings)' : ''
			toast.success(`Opened ${basename(filePath)} in ${editorName}${configureHint}`)
		} catch (error) {
			const failure = Predicate.isError(error)
				? error
				: new Error('Unable to open the selected file in the editor', { cause: error })
			logger.error('Failed to open file in editor:', error)
			captureException(failure, {
				tags: { action: 'openFileInEditor' },
				extra: { editor },
			})
			toast.error(`Failed to open file: ${failure.message}`)
		}
	} else {
		// Browser fallback - copy path to clipboard
		try {
			await navigator.clipboard.writeText(fullPath)
			toast.info(`Copied path to clipboard: ${fullPath}`)
		} catch (error) {
			logger.error('Failed to copy path to clipboard:', error)
			toast.error('Failed to copy path to clipboard')
		}
	}
}
