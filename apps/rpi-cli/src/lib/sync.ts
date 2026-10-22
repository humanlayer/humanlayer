import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

import { ensureLinkToIssue } from '@humanlayer/linear-cli/commands/ensureLink'
import { maybeGetLinearClient } from '@humanlayer/linear-cli/utils/client'
import { extractIssueId } from '@humanlayer/linear-cli/utils/git'
import * as Predicate from 'effect/Predicate'

import {
	commit,
	getRemoteDefaultBranch,
	getRemoteUrl,
	getStagedTaskFiles,
	getUpstreamBranch,
	hasChanges,
	pullRebase,
	pushWithUpstream,
	stageAll,
} from './git-utils'

export interface SyncResult {
	success: boolean
	committed: boolean
	pushed: boolean
	error?: string
	conflictDetected?: boolean
}

export interface SyncOptions {
	message?: string
	skipPush?: boolean
	skipLinear?: boolean
}

/**
 * Check if a file path is within the rpi/ directory of the project.
 * Handles relative paths, absolute paths, and dot-prefixed paths.
 */
export function isRpiPath(rawPath: string, projectDir: string): boolean {
	// Normalize to absolute path (relative paths resolved from projectDir)
	const filePath = rawPath.startsWith('/') ? rawPath : resolve(projectDir, rawPath)
	const rpiPrefix = `${resolve(projectDir, 'rpi')}/`
	return filePath.startsWith(rpiPrefix)
}

/**
 * Compute GitHub permalink for a file in the artifacts repo.
 * Converts SSH URLs to HTTPS.
 */
export async function computePermalink(artifactsRepo: string, filePath: string): Promise<string | null> {
	const remoteUrl = await getRemoteUrl(artifactsRepo)
	if (!remoteUrl) return null

	// Convert SSH to HTTPS
	let httpsUrl = remoteUrl
	if (remoteUrl.startsWith('git@github.com:')) {
		httpsUrl = remoteUrl.replace('git@github.com:', 'https://github.com/').replace(/\.git$/, '')
	} else if (remoteUrl.startsWith('https://github.com/')) {
		httpsUrl = remoteUrl.replace(/\.git$/, '')
	}

	// Detect the correct branch for permalinks
	const branch = await getRemoteDefaultBranch(artifactsRepo)

	return `${httpsUrl}/blob/${branch}/${filePath}`
}

/**
 * Link changed task files to Linear issues.
 */
async function linkChangedFilesToLinear(
	artifactsRepo: string,
	stagedFiles: string[],
	logger?: (msg: string) => void,
): Promise<void> {
	if (stagedFiles.length === 0) {
		logger?.('No staged task files to link to Linear')
		return
	}

	logger?.(`Found ${stagedFiles.length} staged task file(s) to link`)

	// Use maybeGetLinearClient which supports both env var and OAuth tokens
	const linearResult = await maybeGetLinearClient()
	if (!linearResult.resolved) {
		logger?.('Linear client not initialized (no credentials found)')
		return
	}
	const linear = linearResult.linear
	logger?.(`Linear client initialized via ${linearResult.source}`)

	for (const file of stagedFiles) {
		try {
			const issueId = extractIssueId(file)
			if (!issueId) {
				logger?.(`No issue ID found in path: ${file}`)
				continue
			}

			const permalink = await computePermalink(artifactsRepo, file)
			if (!permalink) {
				logger?.(`Could not compute permalink for: ${file}`)
				continue
			}

			const filename = file.split('/').pop() ?? file

			logger?.(`Linking ${filename} to ${issueId}: ${permalink}`)
			const result = await ensureLinkToIssue(linear, issueId, permalink, { title: filename })

			if (result.created) {
				logger?.(`Linked ${filename} to ${issueId}`)
			} else if (result.skipped) {
				logger?.(`Link already exists for ${filename} on ${issueId}`)
			} else if (result.error) {
				logger?.(`Failed to link ${filename}: ${result.error}`)
			}
		} catch (cause) {
			const message = Predicate.isError(cause) ? cause.message : 'Unknown error'
			logger?.(`Error linking ${file}: ${message}`)
		}
	}
}

/**
 * Synchronize artifacts repository.
 * Pure function - no process.exit, returns result object.
 */
export async function syncArtifacts(
	artifactsRepo: string,
	options: SyncOptions = {},
	logger?: (msg: string) => void,
): Promise<SyncResult> {
	const { message, skipPush = false, skipLinear = false } = options

	// Use Node's fs.access instead of Bun's file().exists() for compiled binary compatibility
	try {
		await access(artifactsRepo)
	} catch {
		return { success: false, committed: false, pushed: false, error: 'Artifacts repo does not exist' }
	}

	try {
		// Stage all changes
		await stageAll(artifactsRepo)

		// Capture staged task files for Linear linking (must be after staging, before commit)
		const stagedTaskFiles = await getStagedTaskFiles(artifactsRepo, 'tasks/')
		logger?.(`Staged task files: ${stagedTaskFiles.length > 0 ? stagedTaskFiles.join(', ') : '(none)'}`)

		// Check for changes
		const hasUncommitted = await hasChanges(artifactsRepo)

		let committed = false
		if (hasUncommitted) {
			const commitMessage = message || `Sync RPI - ${new Date().toISOString()}`
			await commit(artifactsRepo, commitMessage)
			committed = true
			logger?.('Changes committed')
		} else {
			logger?.('No changes to commit')
		}

		// Check if remote exists
		const remoteUrl = await getRemoteUrl(artifactsRepo)
		if (!remoteUrl || skipPush) {
			return { success: true, committed, pushed: false }
		}

		// Check upstream tracking
		const upstream = await getUpstreamBranch(artifactsRepo)

		// Pull with rebase if upstream is set
		if (upstream) {
			try {
				await pullRebase(artifactsRepo)
			} catch (error) {
				const errorMsg = Predicate.isError(error) ? error.message : 'Unable to pull artifacts repository'
				if (errorMsg.includes('conflict')) {
					return { success: false, committed, pushed: false, conflictDetected: true, error: errorMsg }
				}
				logger?.(`Warning: Could not pull: ${errorMsg}`)
			}
		}

		// Push
		let pushed = false
		try {
			const branch = await getRemoteDefaultBranch(artifactsRepo)
			await pushWithUpstream(artifactsRepo, 'origin', branch)
			pushed = true
			logger?.('Pushed to remote')

			// Link to Linear after successful push
			if (!skipLinear && stagedTaskFiles.length > 0) {
				await linkChangedFilesToLinear(artifactsRepo, stagedTaskFiles, logger)
			}
		} catch (pushError) {
			const errMsg = Predicate.isError(pushError) ? pushError.message : 'Unable to push artifacts repository'
			logger?.(`Could not push to remote: ${errMsg}`)
		}

		return { success: true, committed, pushed }
	} catch (error) {
		const errorMsg = Predicate.isError(error) ? error.message : 'Unable to synchronize artifacts'
		return { success: false, committed: false, pushed: false, error: errorMsg }
	}
}
