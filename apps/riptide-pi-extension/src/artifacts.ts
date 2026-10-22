// Task files (plan.md §6), as a lane. The folder link, the hint and the sync are
// @humanlayer/session-sdk-artifacts'; this hands them pi's binding, log and status line.

import { ArtifactSync, artifactsHint as hint, safeSlug, taskFolder } from '@humanlayer/session-sdk-artifacts'

import { daemonCall } from './api.ts'
import { type Binding, recordLink } from './binding.ts'
import { artifactsDir, log } from './config.ts'
import type { LaneHost, Participant } from './lane.ts'

export { HINT_SECTION } from '@humanlayer/session-sdk-artifacts'

/** The prompt hint for a bound or pending session. */
export function artifactsHint(cwd: string, b: Binding): string | undefined {
	return hint(cwd, b.taskSlug, b.sessionUrl)
}

/** The file lane for a bound session, or undefined when its task has no folder. */
export function artifactLane(host: LaneHost): Participant | undefined {
	const slug = safeSlug(host.binding.taskSlug)
	if (!slug) return undefined
	const b = host.binding
	return new ArtifactSync(
		{
			channel: b.channel,
			taskId: host.taskId,
			sessionId: host.sessionId,
			cwd: host.cwd,
			store: artifactsDir(host.taskId),
			signal: host.signal,
			backoff: host.backoff,
			ledger: () => (b.artifactLedger ??= {}),
			save: () => host.save(),
			note: (file) => host.note(file),
			warn: (key, message) => host.warn(key, message),
			log,
			daemonCall,
			recordLink,
		},
		taskFolder(host.cwd, slug),
	)
}
