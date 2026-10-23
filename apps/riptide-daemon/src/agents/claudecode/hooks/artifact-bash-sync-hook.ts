import type { HookCallback, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'

import { Sentry } from '@/instrument'
import { type ArtifactSyncLedger, createArtifactSyncLedger } from '@/lib/artifact-sync-ledger'
import { syncShellCreatedArtifacts } from '@/lib/artifact-sync-utils'
import type { ISyncManager } from '@/lib/sync-service'
import logger from '@/logger'

import { artifactLinkLine, getArtifactCloudUrl } from './artifact-url'

export interface ArtifactBashSyncHookDeps {
	getArtifactCloudUrl?: (artifactId: string) => string | undefined
	ledger?: ArtifactSyncLedger
}

// Files that land in the task directory via Bash (cp, screenshots, scripts)
// have no tool input naming them, so this hook diffs the directory instead.
export function createArtifactBashSyncHook(
	syncManager: ISyncManager,
	sessionId: string,
	cwd: string,
	taskId: string,
	taskSlug: string | null,
	deps: ArtifactBashSyncHookDeps = {},
): HookCallback {
	const getArtifactCloudUrlFn = deps.getArtifactCloudUrl ?? getArtifactCloudUrl
	const ledger = deps.ledger ?? createArtifactSyncLedger()

	return async (
		input: HookInput,
		_toolUseID: string | undefined,
		options: { signal: AbortSignal },
	): Promise<HookJSONOutput> => {
		if (input.hook_event_name !== 'PostToolUse' || options.signal.aborted) {
			return { continue: true }
		}

		try {
			const synced = await syncShellCreatedArtifacts({
				syncManager,
				sessionId,
				cwd,
				taskId,
				taskSlug,
				ledger,
				signal: options.signal,
			})
			if (synced.length === 0) return { continue: true }

			logger.info(
				{ sessionId, taskId, fileNames: synced.map((result) => result.fileName) },
				'Artifacts created by Bash synced to cloud',
			)
			const links = synced
				.map((result) => artifactLinkLine(result.fileName, getArtifactCloudUrlFn(result.artifactId)))
				.join('\n')
			return {
				continue: true,
				hookSpecificOutput: {
					hookEventName: 'PostToolUse',
					additionalContext: `Artifacts synced to cloud:\n${links}`,
				},
			}
		} catch (error) {
			logger.error({ err: error, sessionId, taskId }, 'Artifact directory scan after Bash failed')
			Sentry.captureException(error, { tags: { session_id: sessionId } })
			return { continue: true }
		}
	}
}
