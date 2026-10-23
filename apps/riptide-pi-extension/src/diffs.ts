// Lane: the task diff. The build and publish are @humanlayer/session-sdk-diffs'; this starts one
// for a bound session and keeps what it published in the binding file.

import { basename } from 'node:path'

import { DiffSync } from '@humanlayer/session-sdk-diffs'

import { daemonToken, remintDaemonToken } from './auth.ts'
import { getChannelConfig, log } from './config.ts'
import type { LaneHost, Participant } from './lane.ts'

export {
	buildDiff,
	type DiffErrorKind,
	type DiffRows,
	DiffSync,
	type DiffSyncOptions,
	type DiffTarget,
	DiffTargetError,
	type TaskDiffFileRow,
	type TaskDiffPatchRow,
} from '@humanlayer/session-sdk-diffs'

/**
 * The diff lane for a bound session (capture.ts): tasks this session made, in a repo with a commit.
 * A task it only joined ("use") belongs to the daemon of that task's worktree, which sends its diff.
 */
export function diffLane(host: LaneHost): Participant | undefined {
	const b = host.binding
	if (b.taskMode !== 'ensure' || !b.git?.headSha || !b.orgId) return undefined
	const sync = new DiffSync(
		{
			syncUrl: getChannelConfig(b.channel).sync,
			orgId: b.orgId,
			taskId: host.taskId,
			sessionId: host.sessionId,
			gitRoot: b.git.root,
			baseSha: b.git.headSha,
			repoId: basename(b.git.root),
			published: b.diffPublished ?? {},
		},
		{
			daemonToken: () => daemonToken(b.channel, host.signal),
			remintDaemonToken: () => remintDaemonToken(b.channel, host.signal),
			onPublished: (published) => {
				b.diffPublished = published
				host.save()
			},
			onError: (kind, message) => {
				if (kind !== 'transient') host.warn(`diffs:${kind}`, `HumanLayer: task diff ${kind}: ${message}`)
			},
			log,
		},
	)
	sync.touched() // the tree may have changed since the last publish
	return sync
}
