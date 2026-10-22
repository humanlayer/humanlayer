import type { DaemonServices } from '@/agents/claudecode/types'
import { resolveSessionWorkspaceView } from '@/effects/services/task-workspace-context/resolve-session-workspace-view'
import { normalizePath } from '@/lib/utils'
import { materializedWorkspaceRepoDirectories } from '@/lib/workspace/render-workspace-information'

export interface SessionRepoDirsSession {
	working_directory: string
	task_id: string | null
	host_id: string
}

export type WorkspaceSetupRows = DaemonServices['collections']['workspaceSetup']['toArray']

/**
 * A session's repo dirs: its working directory plus worktrees materialized on this host.
 * `setupRows` is materialized ONCE per reconcile by the caller (`.toArray` builds a fresh
 * array per access — per-session access was O(sessions × rows) every cycle).
 *
 * Both task generations stay supported: a legacy task resolves from the synced setup ledger as
 * before, and a project-workspace task resolves through the daemon's recently read task context,
 * so a reconcile over many sessions costs at most one API read per task per freshness window and
 * only ever sees this user/host's own worktrees. The trackers that call this still live outside
 * Effect, so the resolution runs in the daemon runtime here.
 */
export async function sessionRepoDirs(input: {
	session: SessionRepoDirsSession
	services: DaemonServices
	setupRows: WorkspaceSetupRows
}): Promise<string[]> {
	const { session, services, setupRows } = input
	// normalizePath: a `~`-prefixed working_directory would hand git an invalid cwd and the
	// session's repo would never resolve (the arm/renew paths normalize the same way).
	const workingDirectory = normalizePath(session.working_directory)
	const dirs = [workingDirectory]
	try {
		if (session.task_id) {
			const task = services.collections.tasks.get(session.task_id)
			if (task) {
				const { view } = await services.daemonRuntime.runPromise(
					resolveSessionWorkspaceView({ task, hostId: session.host_id, setupRows, freshness: 'tracking' }),
				)
				if (view) {
					// The same expanded cwd is excluded from its own sibling list, `~`-prefixed or not.
					dirs.push(...materializedWorkspaceRepoDirectories(view, workingDirectory))
				}
			}
		}
	} catch {
		// best-effort: just the working directory
	}
	return dirs
}
